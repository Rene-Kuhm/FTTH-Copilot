# Probar sin hardware

**Objetivo:** ejercitar los cuatro planos del sistema (NOC, SOC, NMS y SNMP) con datos
sintéticos y un Postgres local, sin un solo OLT, ONU o NMS físico.

## Requisitos

- Node ≥ 22 y pnpm 11.22.0.
- Docker (o un Postgres 16 accesible) para la base.
- Para el plano SNMP, los binarios de `net-snmp` no son necesarios: el script `test:snmp`
  manda PDUs binarios por UDP desde Node.

## 1. Levantar Postgres

```bash
docker run -d --name ftth-pg \
  -e POSTGRES_USER=ftth \
  -e POSTGRES_PASSWORD=ftth \
  -e POSTGRES_DB=ftth_copilot \
  -p 5432:5432 \
  postgres:16

export DATABASE_URL=postgresql://ftth:ftth@localhost:5432/ftth_copilot
```

Si el schema todavía no existe:

```bash
pnpm db:deploy
```

`db:deploy` corre `prisma migrate deploy`. Para desarrollo local, `pnpm db:migrate`
(`prisma migrate dev`) es lo que genera migraciones nuevas.

## 2. `pnpm test:scenario` — NOC de punta a punta

```bash
DATABASE_URL=postgresql://ftth:ftth@localhost:5432/ftth_copilot pnpm test:scenario
```

Qué hace (`scripts/seed-scenario.ts`):

1. **Borra y recrea** el tenant `scenario-tenant` y su conexión `scenario-connection`. Es
   idempotente: correrlo N veces deja el mismo estado.
2. Siembra la serie sintética de degradación que devuelve
   `buildNocDegradationScenario` (`packages/analytics/src/scenario.ts`): RX cayendo hacia
   −27 dBm, FEC corregido en aumento, FEC no corregido apareciendo y caída del bias
   current.
3. Corre la pipeline de detección real (`runDetection` de `packages/alerts`).
4. Imprime las alertas y los incidentes resultantes.

Salida esperada (el número exacto de alertas depende de los umbrales):

```text
Seeded 48 metric samples.
Detection result: { detected: 4, upserted: 4, notified: 0, ... }

Alerts (4):
  - [critical] fec_degradation on onu-scenario-1: ...
  - [warning]  fec_degradation on onu-scenario-1: ...
  - [warning]  predicted_low_signal on onu-scenario-1: ...
  - [warning]  optical_degradation on onu-scenario-1: ...

Incidents (1):
  - [critical] ...
```

Lo que aserta, sin que haya que mirarlo: aparecen las cuatro familias de señal
degradada, y las alertas se **correlacionan en un solo incidente** por equipo (una ONU con
varios síntomas es un problema, no varios).

## 3. `pnpm test:syslog` — SOC de punta a punta

Con el receptor habilitado en otra terminal:

```bash
SYSLOG_RECEIVER_ENABLED=true SYSLOG_TENANT_ID=scenario-tenant pnpm dev
```

Y en una tercera:

```bash
pnpm test:syslog
```

Qué hace (`scripts/send-syslog.ts`): manda por UDP 6 fallos de autenticación desde la misma
IP, 1 acceso y 1 cambio de configuración (`buildSocScenarioMessages` en
`packages/security/src/syslog-build.ts`).

Lo que aserta: el receptor parsea RFC 3164, clasifica los eventos y el barrido de
detección (`runSecurityDetection`) produce los hallazgos de brute force, acceso posterior a
fallos y cambio de configuración. Los eventos quedan en `DeviceEvent` con su
`sourceIp`.

`SYSLOG_HOST` (default `127.0.0.1`) y `SYSLOG_PORT` (default `5514`) cambian el destino.

## 4. `pnpm test:mock-nms` — el NMS por HTTP

```bash
pnpm test:mock-nms
```

Levanta el NMS simulado en `:5515`. Los detalles (rutas, `baseUrl` por proveedor, flags de
red) están en [Usar el mock NMS](usar-el-mock-nms.md).

## 5. `pnpm test:snmp` — SNMP extremo a extremo

```bash
pnpm test:snmp
```

Qué hace (`scripts/test-snmp.ts`): levanta un receptor SNMP en `127.0.0.1:12180` y manda
**13 notificaciones** esperando que lleguen todas:

- SNMP v1 (Trap), SNMP v2c (TrapV2) e InformRequest.
- SNMP v3 con `authPriv` (SHA + AES), usuario `noc-operator`.
- Un `authenticationFailure` de RFC.
- Trampas de vendor de Huawei, ZTE, Nokia, FiberHome, Calix, Adtran, VSOL y BDCOM.

Lo que aserta:

- Que llegaron las 13 notificaciones (el script falla si no).
- Que cada evento de telemetría valida contra `telemetryEventSchema`
  (`packages/shared/src/contracts.ts`).
- Que cada adapter de vendor traduce la trampa al `deviceKind`/`deviceId` correctos.

## 6. Los tres niveles de tests automáticos

| Nivel | Qué cubre | Comando | Necesita |
|---|---|---|---|
| Unit | Detectores puros, parsers, contratos, adapters | `pnpm test` (o `pnpm test:unit`) | — |
| Integración | Pipeline real contra Postgres | `pnpm --filter @ftth-copilot/alerts test:integration` y `pnpm --filter @ftth-copilot/db test:integration` | Postgres + `DATABASE_URL` |
| E2E | UI, chat, dashboard y contratos HTTP con Playwright | `pnpm test:e2e` | Chromium + Postgres |

Los tests de integración usan `vitest.integration.config.ts`, que queda fuera de `vitest
run` a propósito para que las corridas unitarias y de cobertura sean herméticas. El CI los
corre explícitamente (`.github/workflows/ci.yml`, job `test-integration`).

El E2E necesita las variables del job de CI: `JWT_SECRET`, `KMS_MASTER_KEY`,
`SEED_ADMIN_PASSWORD`, `ENABLE_TEST_AUTH_BYPASS=true`, `E2E_LOGIN_EMAIL` y
`E2E_LOGIN_PASSWORD`, más el schema migrado (`pnpm --filter @ftth-copilot/db db:deploy`) y
la cuenta admin sembrada (`pnpm --filter @ftth-copilot/db db:seed`).

## 7. El laboratorio de conformidad SNMP

```bash
./scripts/run-conformance-lab.sh            # usa Docker si está disponible
./scripts/run-conformance-lab.sh --native   # sin build de imagen
```

El script auto-detecta `docker` y después `podman` (`scripts/run-conformance-lab.sh`). En
ambos modos corre lo mismo:

```bash
pnpm --filter @ftth-copilot/monitoring run test tests/conformance
npx tsx scripts/snmp-benchmark.ts
```

La suite de conformidad (`packages/monitoring/tests/conformance/`) incluye los golden
snapshots, el aislamiento por tenant, los escenarios de falla, la property-based sobre
ASN.1 y el ciclo de vida de contribución Gate 8. El benchmark mide throughput de ingesta
UDP, delta de heap, tasa de drop y percentiles de latencia, y escribe
`research/olt/conformance-report.json` y `docs/conformance-benchmark.md`.

## Cómo verificar

```bash
# El tenant del escenario existe y tiene muestras
psql "$DATABASE_URL" -c "select tenant_id, count(*) from metric_samples group by 1;"

# El plano NOC produce alertas
psql "$DATABASE_URL" -c "select kind, severity, device_id from detected_alerts;"

# El plano SOC/events registran los eventos syslog
psql "$DATABASE_URL" -c "select category, count(*) from device_events group by 1;"

# La app responde y dice qué servicios espera
curl -sS http://127.0.0.1:3001/api/health | head -c 800
```

## Troubleshooting

- **`pnpm test:scenario` falla con `Can't reach database`** → falta `DATABASE_URL` exportada
  en **esa** terminal, o el Postgres no está levantado.
- **`pnpm test:scenario` corre pero no imprime alertas** → el seed no corrió: mirá la
  primera línea (`Seeded N metric samples.`). Si dice 0, la serie no se persistió.
- **`pnpm test:syslog` no muestra nada en el panel** → el receptor está inerte: falta
  `SYSLOG_TENANT_ID`, o el `SYSLOG_TENANT_ID` no corresponde a un tenant existente. El
  tenant que crea el escenario es `scenario-tenant`.
- **`pnpm test:snmp` dice "Expected 13 notifications, but received N"** → el puerto 12180
  está ocupado o hay un firewall. El script usa un puerto fijo.
- **`pnpm test:e2e` falla con "JWT_SECRET is not set"** → exportá `JWT_SECRET` y
  `KMS_MASTER_KEY` antes de correrlo; en modo producción el proceso se niega a arrancar
  sin ellos.
- **`./scripts/run-conformance-lab.sh` se cuelga building the image** → usá `--native`.
