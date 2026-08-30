# Testing FTTH-Copilot without hardware

> **Principio:** los detectores son funciones puras, los conectores tienen `fetch` inyectable, el receptor syslog es UDP, y la UI corre contra fixtures en modo demo. **No necesitás OLTs, ONUs ni NMS físico** para probar todo.

## El modelo mental

```text
sin hardware                          con hardware
─────────────                         ─────────────
detectores: series sintéticas          series reales (poller NMS)
SOC:       UDP syslog sintético        syslog de los equipos
UI/chat:   DEMO_MODE_ENABLED=true      conectores validados
NMS live:  mock-nms scaffold           SmartOLT/Mikrowisp reales
```

Tres niveles de prueba que ya funcionan hoy + tres comandos nuevos para ver el sistema "de punta a punta" sin equipamiento.

## 1. Tests automáticos (cero equipamiento, ya corren en CI)

| Nivel | Qué prueba | Comando | Necesita |
|-------|-----------|---------|---------|
| **Unit** | Detectores puros (RX, FEC, óptica, flapping, SOC) y reglas | `pnpm test` | — |
| **Integración** | Pipeline real contra Postgres sembrado | `pnpm --filter @ftth-copilot/alerts test:integration` | Postgres |
| **E2E** | UI/chat/dashboard/alerts contra fixtures | `pnpm test:e2e` | Chromium |

El CI ya levanta `postgres:16` para la integración. Para correrlo local:

```bash
docker run -d --name ftth-pg -e POSTGRES_USER=ftth -e POSTGRES_PASSWORD=ftth -e POSTGRES_DB=ftth_copilot -p 5432:5432 postgres:16
export DATABASE_URL=postgresql://ftth:ftth@localhost:5432/ftth_copilot
pnpm --filter @ftth-copilot/alerts test:integration
```

## 2. La app contra fixtures (modo demo)

```bash
cp .env.example .env
# Configurá: DATABASE_URL, JWT_SECRET, KMS_MASTER_KEY
echo 'DEMO_MODE_ENABLED=true' >> .env
pnpm dev
```

Con `DEMO_MODE_ENABLED=true`, el chat, el dashboard y las alertas usan los **fixtures** de SmartOLT/Mikrowisp (no se llama a ningún NMS). La UI queda navegable de punta a punta sin un solo equipo.

## 3. Los tres comandos nuevos (harness de simulación)

Cuando `pnpm install` registra los devDeps del root (tsx + los workspace packages necesarios), quedan disponibles tres comandos que ejercitan el sistema contra datos sintéticos.

### `pnpm test:scenario` — NOC end-to-end (seed + detección)

Siembra un escenario de degradación (RX cayendo hacia −27 dBm, FEC corregido creciendo, FEC no corregido apareciendo, bias sagging) y corre la pipeline de detección, imprimiendo las alertas e incidentes resultantes.

```bash
docker run -d --name ftth-pg ... postgres:16   # si no lo tenés
export DATABASE_URL=postgresql://ftth:ftth@localhost:5432/ftth_copilot
pnpm test:scenario
```

Salida esperada (resumen):

```text
Seeded 48 metric samples.
Detection result: { detected: 4, upserted: 4, notified: 0, ... }

Alerts (4):
  - [critical] fec_degradation on onu-scenario-1: FEC no corregido en onu-scenario-1
  - [warning]  fec_degradation on onu-scenario-1: FEC en aumento: onu-scenario-1
  - [warning]  predicted_low_signal on onu-scenario-1: Señal en caída: onu-scenario-1
  - [warning]  optical_degradation on onu-scenario-1: Bias current fuera de rango: onu-scenario-1

Incidents (1):
  - [critical] ...
```

El escenario es **idempotente**: cada corrida borra el tenant `scenario-tenant` y lo recrea.

### `pnpm test:syslog` — SOC end-to-end (fuerza bruta sintética)

Envía por UDP un escenario SOC: 6 fallos de auth desde la misma IP (brute force) + 1 acceso (access_after_failures) + 1 cambio de configuración. Va al receptor syslog local.

Primero levantá la app con el receptor activo:

```bash
export SYSLOG_RECEIVER_ENABLED=true
export SYSLOG_TENANT_ID=local
pnpm dev

# En otra terminal:
pnpm test:syslog
```

Variables opcionales: `SYSLOG_HOST` (default `127.0.0.1`), `SYSLOG_PORT` (default `5514`).

### `pnpm test:mock-nms` — NMS mock (HTTP)

Levanta un servidor HTTP en `:5515` que responde con las formas reales de SmartOLT (`get_olts`, `get_all_onus_details`) y Mikrowisp (`GetRouters`, `GetMonitoreo`). Las rutas se eligen por prefijo:

```text
GET/POST /smartolt/api/system/get_olts
GET/POST /smartolt/api/onu/get_all_onus_details
POST /mikrowisp/GetRouters  (token en el body JSON)
POST /mikrowisp/GetMonitoreo
```

Para usar el NMS mock con la app real, configurá la conexión NMS con:

| Proveedor | Base URL |
|----------|----------|
| SmartOLT | `http://127.0.0.1:5515/smartolt` |
| Mikrowisp | `http://127.0.0.1:5515/mikrowisp` |

Variable opcional: `MOCK_NMS_PORT` (default `5515`).

## 4. Combinando los comandos (recorrido completo sin hardware)

Con Postgres corriendo, podés ver el NOC y el SOC funcionando **en paralelo**:

```bash
# Terminal 1: app con todo el plano de vigilancia activo
export DATABASE_URL=postgresql://ftth:ftth@localhost:5432/ftth_copilot
export SYSLOG_RECEIVER_ENABLED=true
export SYSLOG_TENANT_ID=local
pnpm dev

# Terminal 2: ver el NOC detectar degradación sintética
pnpm test:scenario

# Terminal 3: ver el SOC detectar fuerza bruta sintética
pnpm test:syslog

# Terminal 4: NMS mock (si querés probar el conector "live" contra un NMS local)
pnpm test:mock-nms
```

El tablero (`/dashboard`) mostrará los **paneles de Incidentes, Predicciones, SLA y Accesos** con datos sintéticos sin un solo OLT/ONU físico.

## 5. Troubleshooting

- **`pnpm test:scenario` falla con `Can't reach database`** → arrancá el Postgres (`docker run ... postgres:16`) y exportá `DATABASE_URL`.
- **`pnpm test:syslog` no muestra nada en el panel de Accesos** → verificá que `SYSLOG_TENANT_ID` esté setado y coincida con un tenant existente (o usá el tenant que crea el seed-scenario).
- **El conector "live" no llega al mock NMS** → revisá que el `baseUrl` de la conexión termine exactamente en `/smartolt` o `/mikrowisp` (sin barra final, con el path raíz del proveedor como prefijo).
