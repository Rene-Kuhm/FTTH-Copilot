# Demo Environment — Variables

Copiá este contenido a un archivo `.env` en la raíz del proyecto para levantar el demo:

```bash
# PostgreSQL
DATABASE_URL=postgresql://ftth:demo123@postgres:5432/ftth_copilot
POSTGRES_USER=ftth
POSTGRES_PASSWORD=demo123
POSTGRES_DB=ftth_copilot
POSTGRES_PORT=5432

# Auth and encryption (demo values — change in production)
JWT_SECRET=demo-jwt-secret-change-in-production-32b
KMS_MASTER_KEY=demo-kms-master-key-change-in-production-32

# Demo admin password (shown in console on first run)
SEED_ADMIN_PASSWORD=demo12345

# Server
PORT=3001
NODE_ENV=development
SESSION_COOKIE_SECURE=false

# ── Demo mode (must be false in production) ────────────────────────────────
DEMO_MODE_ENABLED=true
DEMO_DATA_ENABLED=true
ALLOW_PRODUCTION_SEED=true

# Rate limits (relaxed for demo)
CHAT_RATE_LIMIT_PER_MINUTE=100
CHAT_DAILY_QUOTA=2000
INVESTIGATION_RATE_LIMIT_PER_MINUTE=100
INVESTIGATION_DAILY_QUOTA=1000
AUTH_RATE_LIMIT_MAX=50

# ── SmartOLT — demo uses mock fixtures ────────────────────────────────────
SMARTOLT_USE_MOCK=true
SMARTOLT_API_BASE_URL=https://api.smartolt.com
SMARTOLT_API_KEY=mock-api-key

# ── Mikrowisp — demo uses mock fixtures ────────────────────────────────────
MIKROWISP_API_BASE_URL=https://demo.mikrowisp.com/api/v1
MIKROWISP_TOKEN=mock-token

# ── Network safety (locked for demo) ───────────────────────────────────────
NMS_REQUEST_TIMEOUT_MS=10000
NMS_ALLOWED_PORTS=443
NMS_ALLOWED_HOSTS=
NMS_ALLOW_HTTP=false
NMS_ALLOW_PRIVATE_NETWORKS=false

# ── Observability ──────────────────────────────────────────────────────────
METRICS_POLLER_ENABLED=false
METRICS_BEARER_TOKEN=

# ── Alert channels (disabled in demo) ──────────────────────────────────────
ALERT_WEBHOOK_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ── LLM providers (leave empty to use dashboard without chat agent) ───────
LLM_PROVIDER=
LLM_FALLBACK=
MINIMAX_API_KEY=
DEEPSEEK_API_KEY=
QWEN_API_KEY=

LOG_LEVEL=info
```

## Credenciales de demo

| Parámetro | Valor |
|---|---|
| **URL** | `http://localhost:3001` |
| **Email** | `admin@ftth-copilot.local` |
| **Contraseña** | `demo12345` (configurada por `SEED_ADMIN_PASSWORD`) |

## Datos sintéticos incluidos

El demo prepobla automáticamente:

- **5 OLTs** con temperaturas y estados variados (1 con temperatura alta: OLT-Este)
- **~42 ONUs** con distribución realista de estados:
  - 37 online
  - 4 offline (incluyendo 2 del mismo OLT-Este en ventana compartida)
  - 1 degradada con señal borderline (–26.5 dBm)
- **Métricas de serie temporal** para 3 ONUs:
  - ONU offline con historial de LOS creciente antes del corte
  - ONU con 10 días de uptime estable
  - ONU degradada con historial de señal en caída
- **Alertas tempranas**:
  - Predicción de baja señal para la ONU en degradación
  - OLT con temperatura elevada (OLT-Este a 68 °C)
