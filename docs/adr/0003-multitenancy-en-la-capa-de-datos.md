# ADR 0003 — Multi-tenancy en la capa de datos

**Estado:** Aceptada
**Fecha:** 2026-08-20 (migración `20260820054804_init`)

## Contexto

El producto es **multi-tenant desde el día uno**: cada ISP es un cliente con su propia red,
sus propios usuarios, sus propias credenciales de NMS y sus propias datos de operación. El
header del schema lo dice explícitamente: *"Multi-tenant from day 1 (per project guide
§3.1)"* (`packages/db/prisma/schema.prisma:2`).

Los datos que maneja el sistema son sensibles por naturaleza: credenciales de API de NMS,
historial de conversaciones de operadores, IPs de abonados, y auditoría de accesos. Una
filtración entre dos ISP no es un bug de performance: es un incidente contractual.

El riesgo de diseño clásico es tratar el aislamiento como una **disciplina de aplicación**:
un `where: { id }` sin `tenantId` en algún handler, y dos tenants se ven los datos. Con
decenas de rutas API y muchos paquetes, esa disciplina se rompe.

## Decisión

Hacer del **tenant la raíz del modelo de datos**, y que el aislamiento sea una propiedad
estructural del schema, no una convención de los handlers.

- `Tenant` es el padre de 31 modelos, todos con `tenantId` → `Tenant.id` y
  `onDelete: Cascade` (`schema.prisma:163-200`). Borrar el tenant borra su historia.
- **Todas las unicidades de negocio incluyen `tenantId` primero**: `[tenantId, email]`,
  `[tenantId, provider, label]`, `[tenantId, connectionId, kind, deviceKind, deviceId]`,
  `[tenantId, connectionId, deviceKind, deviceId]`, `[tenantId, sourceIncidentId]`,
  `[tenantId, runId]`, `[tenantId, versionId]`, `[tenantId, evidenceId]`. Dos tenants
  pueden tener la misma ONU `onu-42` sin colisionar.
- Las **referencias blandas** son explícitas y documentadas en comentarios: `deviceId`,
  `parentId`/`childId` de topología, `sourceIncidentId`,
  `investigationFeedbackId`, `runRefId`. No son olvidos: son identificadores externos del
  NMS o referencias cuyo borrado en cascada destruiría conocimiento.
- Las **FKs opcionales usan `SetNull`, nunca `Cascade`**: las ocho `connectionId`, más
  `PlanMarker.zoneId` y `ConfirmedIncident.confirmedByUserId`. Los datos sobreviven al
  conector que los produjo.
- `AuthRateLimit` es la única tabla de contadores **sin** FK a tenant, y el motivo está
  escrito en el schema (`schema.prisma:454-458`): el contador anti brute-force existe antes
  de que el atacante se identifique.
- En la capa de aplicación, un recurso de otro tenant responde **404**, no 403: un 403
  confirmaría que el recurso existe (`apps/web/app/api/incidents/[id]/route.ts:38-45`).

## Consecuencias

### Buenas

- **El error por omisión no rompe el aislamiento.** Si un handler olvida el filtro, el
  índice compuesto sigue impidiendo colisiones entre tenants en la escritura. La fuga
  sigue siendo posible en la lectura, pero requiere un descuido explícito en el handler, no
  sólo la ausencia de una constraint.
- La unicidad compuesta resuelve a la vez dos problemas: no duplicar alertas por equipo y
  permitir nombres iguales en tenants distintos.
- `Cascade` desde `Tenant` hace que el borrado de un cliente sea una operación limpia y
  completa, sin huérfanos.
- `SetNull` en `connectionId` significa que **reconfigurar un conector NMS no destruye
  historia**: las métricas quedan, con su procedencia, y su `connectionId` pasa a `NULL`.
- El 404 en vez del 403 evita filtrar la existencia de recursos ajenos.

### Malas

- **31 tablas con `tenantId` significa 31 lugares donde se puede olvidar el filtro** en una
  query. El schema ayuda, pero no lo impide: el aislamiento en lectura sigue siendo
  responsabilidad de cada handler.
- `User.email` es único **global**, no por tenant. Eso impide que dos ISP distintos tengan
  usuarios con el mismo email, y hace redundante el unique compuesto `[tenantId, email]`.
  No está documentado si es intencional.
- Los índices compuestos con `tenantId` primero son más grandes y escriben más.
- `AuthRateLimit` sin FK exige que la limpieza de contadores expirados se haga por tiempo
  (`expiresAt` con índice) y no por relación.
- Añadir un modelo nuevo exige **acordarse** de agregar `tenantId`. Nada en el schema
  obliga a que un modelo sea tenant-scoped: es una convención con consecuencias, no un
  invariante verificado por la base.

### Abiertas

- Las seis tablas que no tienen `tenantId` (`Session`, `RateLimitBucket`, `Message`,
  `OnCallEntry`, `AuthRateLimit`, `Tenant`) se alcanzan transitivamente. Es correcto, pero
  hace que "filtrá por tenant" no sea una regla uniforme: a veces hay que filtrar por
  `userId` o por `conversationId`.
- `TopologyEdge.parentId`/`childId` no tienen FK porque son ids externos del NMS. Eso
  permite filas huérfanas si el NMS renombra un equipo; nada garantiza la integridad
  referencial de esa parte del grafo.
