# ADR 0002 — PostgreSQL + Prisma como store único

**Estado:** Aceptada
**Fecha:** 2026-08-20 (migración `20260820054804_init`)

## Contexto

El sistema produce cuatro clases de datos que se consultan de formas muy distintas:

1. **Series temporales** de métricas por dispositivo (`MetricSample`), que se consultan por
   ventana y por dispositivo.
2. **Estado derivado** con deduplicación: alertas, incidentes, evidencia.
3. **Memoria de conocimiento**: incidentes confirmados con sus tokens de búsqueda.
4. **Historial append-only**: `AgentActionLog`, `VerdictLog`, `AuditLog`.

Además, el producto tiene que sostener auditorías: un ISP necesita poder reconstruir qué
se le dijo al operador, cuándo y con qué evidencia.

El sistema también tiene que correr **en las instalaciones del cliente**, que no siempre
tienen un equipo de operaciones con un clúster de bases de datos. Un componente distribuido
más (Redis, un broker, un vector store) multiplica la superficie operativa de cada
instalación.

## Decisión

Usar **PostgreSQL como store único**, con **Prisma** como capa de acceso, y no
introducir un segundo motor de datos.

- Datasource `postgresql` con `url = env("DATABASE_URL")`
  (`packages/db/prisma/schema.prisma:12-15`).
- El cliente Prisma se genera con `prisma-client-js` y se expone como
  `@ftth-copilot/db` con un **singleton** cacheado en `globalThis`
  (`packages/db/src/client.ts:35`), con auto-descubrimiento de `.env` en cuatro rutas
  candidatas (`client.ts:11-28`).
- El acceso a la base se centraliza en el paquete `@ftth-copilot/db`. Ningún otro paquete
  importa Prisma.
- Los índices se diseñan para las consultas reales: por ejemplo
  `MetricSample` tiene un índice compuesto
  `[tenantId, connectionId, deviceKind, deviceId, kind, sampledAt]` (`schema.prisma:346`).
- Las migraciones se versionan en `packages/db/prisma/migrations/` (27 a la fecha) y se
  aplican con `prisma migrate deploy` (`pnpm db:deploy`), nunca con `migrate dev` en
  producción.
- La unicidad de negocio se resuelve con constraints compuestos que incluyen `tenantId`, no
  con lógica de aplicación.

## Consecuencias

### Buenas

- **Una sola cosa que respaldar.** El backup es un `pg_dump`; la restauración es un
  `pg_restore`. No hay estado repartido entre Redis, un broker y la base.
- El modelo de datos es **explícito y versionado**: los 27 directorios de migración
  cuentan la historia del producto en orden.
- Los uniques compuestos **hacen imposible** el duplicado de una alerta activa por equipo
  o de un incidente por equipo, sin importar si dos peticiones llegan a la vez.
- `SetNull` en las FKs opcionales (`connectionId`) hace que borrar un conector NMS no
  arrastre la historia de métricas que se recolectó con él.
- Postgres cubre bien el caso "muchas escrituras append-only + consultas analíticas
  agregadas": `VerdictLog` y `AgentActionLog` son tablas Append-only con índices por
  tenant y fecha.

### Malas

- **Postgres es el punto único de falla y el cuello de botella.** El sistema entero depende
  de que la base esté sana; `GET /api/health` reporta `database` y devuelve 503 si está
  degradada.
- Los índices compuestos ocupan espacio y escriben más: cada `MetricSample` actualiza
  varios índices.
- Retener métricas exige una rutina de borrado (`runRetention`, con
  `METRICS_RETENTION_DAYS` por defecto 30). Sin ella, la tabla crece sin límite.
- `prisma migrate dev` y `prisma migrate deploy` son flujos distintos y equivocarse
  cambia el resultado; por eso los scripts del repo los separan (`db:migrate` vs
  `db:deploy`).
- La búsqueda semántica está **diferida**: `ConfirmedIncident.embedding` existe como
  `Bytes?` pero el retrieval real es BM25 en memoria
  (`packages/evidence/src/bm25-lite.ts`). Cuando haga falta pgvector, la migración
correspondiente.

### Abiertas

- `Tenant.slug` y `User.email` son únicos **globales**, no por tenant. Para `User.email` eso
  significa que la unicidad compuesta `[tenantId, email]` es redundante, y que dos ISP
  distintos no pueden tener usuarios con el mismo email —que puede ser intencional, pero
  no está documentado como tal.
- `CorrelationWeight.tenantId` no tiene `@index`; su unicidad viene del `@unique` de
  campo. Funciona, pero es una inconsistencia con el resto del schema.
