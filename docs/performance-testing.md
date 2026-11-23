# Rendimiento, carga y picos en el laboratorio local

Medí la latencia y la tasa de error de cuatro lecturas de la API y del núcleo durable de ingesta. El arnés usa TypeScript y las dependencias existentes del monorepo. Cada fase tiene su propio límite y el comando devuelve código 1 si alguna métrica o verificación de integridad falla.

## Ejecutar

Instalá las dependencias desde la raíz del repositorio.

```bash
pnpm install --frozen-lockfile --prefer-offline
node --import tsx scripts/perf/runner.test.ts
```

El spool con un sumidero en memoria sirve para medir la escritura en disco y el checkpoint local sin levantar servicios. Si el directorio temporal está en tmpfs, definí `TMPDIR` con un directorio de un volumen local para medir las operaciones sobre ese sistema de archivos.

```bash
pnpm test:perf spool performance
pnpm test:perf spool load
pnpm test:perf spool spike
```

Para los recorridos completos de API y persistencia, creá una instancia local descartable de PostgreSQL 16 o superior con una base vacía llamada `ftth_perf_test`. Configurá `DATABASE_URL` para `127.0.0.1` y esa base, sin parámetros de URL. Usá valores generados para este laboratorio en `JWT_SECRET` y `KMS_MASTER_KEY`. Ambos procesos deben compartir la configuración de la base. Conservá `ENABLE_TEST_AUTH_BYPASS=false` y desactivá los conectores y servicios externos del entorno local.

```bash
pnpm db:deploy
pnpm --filter @ftth-copilot/web build
pnpm --filter @ftth-copilot/web start -H 127.0.0.1 -p 3301
```

En otra terminal, con la misma `DATABASE_URL`, ejecutá un escenario por vez.

```bash
pnpm test:perf api performance
pnpm test:perf api load
pnpm test:perf api spike
pnpm test:perf ingest performance
pnpm test:perf ingest load
pnpm test:perf ingest spike
```

La API mide `GET /api/health?scope=container`, `GET /api/predictions`, `GET /api/incidents` y `GET /api/security/access`. Usa 32 tenants descartables, con 128 filas sintéticas por tenant y por colección, y sesiones obtenidas con el login real durante la preparación. Las lecturas autenticadas verifican páginas de 50 filas y el marcador de tenant de todas las filas. La rotación reparte la carga según la cuota normal de la API de 100 solicitudes por minuto por tenant. Un 429 cuenta como error. El escenario usa el proceso web de producción con su limitador por instancia cuando se ejecuta sin Redis. El chat, las mutaciones y los servicios externos quedan fuera del perfil.

La ingesta mide desde la llegada de un evento sintético al spool hasta la escritura del lote y la confirmación del offset. Usa el drainer del repositorio con lotes de hasta 250 registros y un sondeo cada 50 ms. `ingest` ejecuta el escritor de producción en PostgreSQL y coteja los IDs persistidos y sus tenants. `spool` usa un sumidero en memoria. Ambos validan pérdida cero, integridad por tenant, duplicados y backlog final vacío. Los perfiles comienzan en el punto de entrada al spool. La recepción UDP, Redis y la orquestación del worker quedan fuera de la medición.

## Perfiles y umbrales

Las tasas son hipótesis de laboratorio para comparar corridas. Las tasas de API son agregadas y el tráfico se reparte en partes iguales entre las cuatro rutas. Los percentiles y errores se evalúan por ruta y fase en API, y por fase en ingesta. Los valores de la tabla se aplican tanto a `ingest` como a `spool`.

| Escenario | Fase | API (req/s × s) | Ingesta (eventos/s × s) | p95 / p99 máx. (ms) |
| --- | --- | ---: | ---: | ---: |
| Performance | Base | 4 × 100 | 25 × 10 | 150 / 300 |
| Load | Normal | 8 × 60 | 100 × 15 | 200 / 400 |
| Load | Alta | 24 × 45 | 300 × 15 | 300 / 600 |
| Spike | Antes | 8 × 50 | 100 × 10 | 200 / 400 |
| Spike | Pico | 64 × 10 | 800 × 5 | 600 / 1.200 |
| Spike | Recuperación | 8 × 50 | 100 × 10 | 200 / 400 |

El máximo de errores es de 1 % para API y 0 % para ingesta. Una llegada omitida por el generador falla la prueba. El generador admite hasta 128 solicitudes HTTP o 1.024 eventos pendientes y registra como omitida una llegada que se retrasa al menos 1 s o supera ese límite. Las llegadas se programan por reloj, sin esperar a la respuesta anterior ni vaciar solicitudes antes de cambiar de fase. La latencia incluye la demora desde la llegada programada y, para HTTP, la lectura y validación del cuerpo. Los percentiles usan el rango más próximo sobre respuestas exitosas. Las solicitudes HTTP tienen un timeout de 5 s.

La salida JSON incluye volumen ofrecido, lanzado y exitoso, errores por causa, duración de cada fase y latencias en milisegundos. Compará corridas en el mismo equipo, con el mismo tamaño de fixtures y sin ejecutar otras pruebas al mismo tiempo. Los tenants y el spool temporal se eliminan al terminar normalmente.
