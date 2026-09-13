# FTTH-Copilot — Plataforma NOC/SOC y Telemetría OLT para ISPs FTTH

Plataforma operativa multi-tenant que unifica en una única base compartida (PostgreSQL 16+, auth revocable y conectores NMS) **cuatro planos de operación para redes de fibra óptica**: asistencia conversacional con IA, detección predictiva e investigación cognitiva de fallas (NOC / AIOps), vigilancia perimetral de seguridad (SOC) y recepción de telemetría SNMP en tiempo real compatible con **12 fabricantes de OLT**.

Transforma señales físicas débiles (deriva de potencia óptica RX, caídas dying gasp, intentos de intrusión o firmwares vulnerables) en **unidades de trabajo auditables y accionables**, reduciendo la carga cognitiva del operador del NOC.

---

## Quick Path (Inicio Rápido)

### 1. Entorno de Desarrollo (Local)

**Requisitos previos:** Node.js 22+, pnpm 11+, PostgreSQL 16+ (o Docker para levantarlo automáticamente).

```bash
# 1. Instalar dependencias del monorepo
pnpm install

# 2. Asistente interactivo (configura .env, genera claves KMS/JWT, migra y siembra la base)
pnpm setup

# 3. Iniciar servidor de desarrollo en http://localhost:3001
pnpm dev
```

> [!TIP]
> Para entornos de integración continua o inicializaciones automatizadas sin terminal interactiva, ejecutá:
> ```bash
> pnpm setup --non-interactive # o pnpm setup -y
> ```

**Credenciales iniciales de desarrollo:**

| Parámetro | Valor por defecto | Notas |
|---|---|---|
| **URL Acceso** | `http://localhost:3001` | Interfaz web de chat y tableros NOC/SOC |
| **Organización (Tenant)** | `Demo ISP` (`demo-tenant`) | Entorno multi-tenant preconfigurado |
| **Email Administrador** | `admin@ftth-copilot.local` | Usuario administrador inicial |
| **Contraseña** | Generada en consola | Impresa durante `pnpm setup` (o variable `SEED_ADMIN_PASSWORD`) |

---

### 2. Despliegue en Producción (Servidor Limpio)

**Requisitos previos:** Linux (Ubuntu, Debian, RHEL) o macOS con Docker y Docker Compose.

```bash
# Ejecutar instalador interactivo de producción
./install.sh

# Para aprovisionamiento desatendido (Cloud-Init, Ansible, CI):
./install.sh --non-interactive # o ./install.sh -y
```

El instalador:
1. **Verifica infraestructura:** valida conectividad con el daemon de Docker y disponibilidad de Docker Compose (ofreciendo instalar Docker y su plugin oficial en Linux si no se detectan).
2. **Configura credenciales seguras:** genera `.env.prod` con permisos `0600`, codifica contraseñas de base de datos bajo RFC 3986 y genera claves maestras de 32 bytes (`JWT_SECRET`, `KMS_MASTER_KEY`).
3. **Construye imagen Next.js standalone:** compilación multi-stage optimizada y ejecución con usuario no privilegiado (`non-root`).
4. **Despliega con interpolación estricta:** orquesta `postgres`, migraciones automáticas (`db-migrate`) y `app` inyectando `--env-file .env.prod`.
5. **Aplica fallo estricto (`fail-closed`):** valida `/api/health`, autoriza el sembrado inicial (`ALLOW_PRODUCTION_SEED=true`) y aborta con volcado de logs si ocurre cualquier anomalía.

**Gestión operativa en producción:**
```bash
# Ver logs en tiempo real
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f app

# Reiniciar stack productivo
docker compose --env-file .env.prod -f docker-compose.prod.yml restart

# Detener servicios
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```

---

## El Modelo Mental: Los Cuatro Planos Operativos

El sistema articula cuatro planos cooperativos sobre una base multi-tenant compartida:

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Copiloto Conversacional · NOC & AIOps Cognitivo · SOC Seguridad · Telemetría SNMP │
│  (diagnóstico en LN)     · (fallas proactivas    · (auditoría    · (12 fabricantes │
│                          ·  e investigación)     ·  y ataques)   ·  v1/v2c/v3)     │
└──────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                         Base Compartida Multi-Tenant
          (Auth JWT + sesiones revocables en PG + cifrado KMS + conectores NMS)
```

| Plano | Qué resuelve | Señal que consume | Superficie operativa |
|---|---|---|---|
| **1. Copiloto Conversacional** | Diagnósticos interactivos sobre el estado de ONUs, causas de offline y consultas NMS. | APIs de SmartOLT y Mikrowisp | `/app` (Chat UI) y `/api/chat` |
| **2. NOC & AIOps Cognitivo** | Predicción de derivas ópticas, cálculo de ETA a corte y formulación de hipótesis raíz. | Series temporales (potencia RX, temp) y topología | `/dashboard` (Fallas) y `/api/predictions` |
| **3. SOC Seguridad Perimetral** | Detección de ataques de fuerza bruta, accesos tras fallos y auditoría de firmware con CVEs. | Receptor Syslog UDP (5514) e inventarios | `/dashboard` (Accesos) y `/api/security/access` |
| **4. Telemetría SNMP** | Ingestión binaria de trampas físicas de OLTs con deduplicación y token bucket. | Receptor SNMP UDP (162/1162) v1/v2c/v3 | Ingesta de bajo nivel y catálogo OID |

---

## Matriz de Compatibilidad OLT (12 Fabricantes)

El catálogo incluye **64 definiciones auditadas** y **69 OIDs únicos** libres de colisiones semánticas, documentados en [`packages/monitoring/src/snmp/research/sources.yaml`](packages/monitoring/src/snmp/research/sources.yaml).

| Fabricante | PEN IANA | Nivel de Soporte | Familias Validadas en Laboratorio |
|---|---|---|---|
| **Huawei** | 2011 | L2 Adapter | MA5600, MA5800 |
| **ZTE** | 3902 | L2 Adapter | C300, C600 |
| **Nokia** | 637 / 6527 | L2 Adapter | 7360 ISAM, Lightspan FX |
| **FiberHome** | 3807 | L2 Adapter | AN5516, AN6000 |
| **Calix** | 1251 | L2 Adapter | E7-2, AXOS series |
| **Adtran** | 664 | L2 Adapter | Total Access 5000 (TA5000) |
| **VSOL** | 37950 | L2 Adapter | V1600G series |
| **BDCOM** | 3320 | L2 Adapter | P3600, GP3600 |
| **C-Data** | 34592 | L1 Definition | FD1100, FD1200, FD1600 |
| **DZS** | 368 | L1 Definition | V5800, V8100 series |
| **Ubiquiti** | 41112 | L1 Definition | UFiber OLT, UFiber OLT 4 |
| **Zyxel** | 890 | L1 Definition | OLT1404A, OLT1408A, OLT2406 |
| **Standard RFC** | 0 | L2 Adapter | RFC 2863 IF-MIB (linkUp, linkDown) |
| **Generic xPON** | 0 | L2 Adapter | Interfaz ITU-T G.984 / G.988 genérica |

> [!NOTE]
> Podés consultar el catálogo exhaustivo de OIDs, niveles de severidad y MIBs de origen en [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md).

---

## Conectores NMS y Modo Demostración

- **SmartOLT:** Conector HTTP nativo de producción y fixtures de laboratorio.
- **Mikrowisp:** Conector HTTP nativo de producción y fixtures de laboratorio.
- **NetSense:** En roadmap; la API rechaza explícitamente la conexión sin sustituir datos con mocks silenciosos.

> [!IMPORTANT]
> El modo demostración se habilita únicamente con `DEMO_MODE_ENABLED=true`. En este modo, la UI y el copiloto advierten explícitamente que los datos son sintéticos. En producción debe permanecer siempre en `false`.

---

## Seguridad y Políticas de Aislamiento

- **Cifrado en reposo (AES-256-GCM):** Claves de API y credenciales NMS protegidas con cifrado simétrico autenticado derivado de `KMS_MASTER_KEY`. En producción rechaza iniciar sin esta clave configurada (`fail-closed`).
- **Autenticación revocable:** Sesiones JWT mediante cookies `HttpOnly`, con invalidación y revocación atómica en PostgreSQL.
- **Protección de costos LLM:** Rate limiter atómico en PostgreSQL por usuario y minuto (`CHAT_RATE_LIMIT_PER_MINUTE`), con cuota diaria estricta compartida (`CHAT_DAILY_QUOTA`).
- **Protección SSRF en NMS:** Conexiones con validación previa de DNS contra IPs privadas y metadatos de nube. Excepciones LAN requieren opt-in explícito (`NMS_ALLOW_PRIVATE_NETWORKS=true`).
- **Protección de base de datos:** El sembrado (`seed`) rechaza ejecutarse en producción (`NODE_ENV=production`) salvo autorización explícita (`ALLOW_PRODUCTION_SEED=true` o flag `--force`).

---

## Variables de Entorno Clave

Configuradas y documentadas en [`.env.example`](.env.example):

| Dominio | Variables principales | Propósito |
|---|---|---|
| **NOC Poller** | `METRICS_POLLER_ENABLED`, `METRICS_POLL_INTERVAL_MS`, `METRICS_RETENTION_DAYS` | Intervalo y retención de series temporales de métricas ópticas |
| **NOC Alertas** | `ALERT_WEBHOOK_URL`, `ALERT_COOLDOWN_MS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Despacho de incidentes predictivos por Webhook o Telegram |
| **SOC Syslog** | `SYSLOG_RECEIVER_ENABLED`, `SYSLOG_UDP_PORT`, `SYSLOG_TENANT_ID` | Receptor y analizador UDP de eventos de red |
| **SOC Firmware** | `FIRMWARE_AUDIT_ENABLED`, `FIRMWARE_AUDIT_INTERVAL_MS` | Auditoría de versiones con vulnerabilidades y CVEs conocidas |
| **Red NMS** | `NMS_REQUEST_TIMEOUT_MS`, `NMS_ALLOWED_HOSTS`, `NMS_ALLOW_PRIVATE_NETWORKS` | Políticas de egreso y seguridad perimetral |
| **Inferencia LLM** | `LLM_PROVIDER`, `MINIMAX_API_KEY`, `DEEPSEEK_API_KEY`, `QWEN_API_KEY` | Proveedores de lenguaje natural y llaves de inferencia |

---

## Comandos de Verificación y Testing

### 1. Validación General del Monorepo
```bash
pnpm lint                  # Análisis estático ESLint en los 15 paquetes
pnpm typecheck             # Comprobación de tipos estricta con TypeScript
pnpm test                  # Suite completa de pruebas unitarias (Vitest)
pnpm test:coverage-check   # Control de umbrales mínimos de cobertura
pnpm build                 # Compilación de paquetes y bundle Next.js standalone
pnpm test:e2e              # Pruebas end-to-end completas (Playwright)
```

### 2. Laboratorio y Gobernanza SNMP
```bash
pnpm check:sources         # Comprueba deriva entre el registro de fuentes y la matriz OLT
pnpm check:conflicts       # Escanea colisiones semánticas y solapamientos de OIDs
pnpm check:contribution    # Valida admisión de paquetes y MIBs de nuevos fabricantes
pnpm test:conformance      # Ejecuta el laboratorio de conformidad y golden snapshots (31/31)
pnpm benchmark:snmp        # Prueba sintética de throughput y rendimiento del receptor SNMP
pnpm generate:matrix:write # Regenera docs/compatibility-matrix.md desde las fuentes MIB
```

---

## Estructura del Monorepo

| Paquete / Aplicación | Responsabilidad Principal |
|---|---|
| [`apps/web`](apps/web) | Next.js App Router, chat con IA, tableros NOC/SOC y endpoints REST |
| [`packages/agent-core`](packages/agent-core) | Motor de razonamiento cognitivo, selección de herramientas y diagnóstico |
| [`packages/alerts`](packages/alerts) | Deduplicación, agrupamiento y despacho de alertas a Webhooks y Telegram |
| [`packages/analytics`](packages/analytics) | Ingesta, agregación y persistencia de métricas temporales de fibra |
| [`packages/connectors/core`](packages/connectors/core) | Tipos canónicos y políticas estrictas de seguridad SSRF para NMS |
| [`packages/connectors/smartolt`](packages/connectors/smartolt) | Adaptador para SmartOLT API (cliente HTTP y fixtures de laboratorio) |
| [`packages/connectors/mikrowisp`](packages/connectors/mikrowisp) | Adaptador para Mikrowisp API (cliente HTTP y fixtures de laboratorio) |
| [`packages/db`](packages/db) | Esquema Prisma, cliente tipado, migraciones y cifrado KMS (AES-256-GCM) |
| [`packages/detection`](packages/detection) | Algoritmos estadísticos (mediana + MAD) para deriva óptica y térmica |
| [`packages/eval`](packages/eval) | Arnés de evaluación estricto (attack-pass-rate 100%) y tenants piloto |
| [`packages/evidence`](packages/evidence) | Normalización de evidencias crudas y sobres de investigación |
| [`packages/monitoring`](packages/monitoring) | Receptor binario SNMP, adaptadores OLT de 12 fabricantes y laboratorio |
| [`packages/security`](packages/security) | Analizador RFC 3164/5424 de paquetes syslog y clasificadores de ataques |
| [`packages/shared`](packages/shared) | Contratos canónicos Zod, esquemas compartidos y tipos de telemetría |
| [`packages/soc`](packages/soc) | Orquestación perimetral, correlación de accesos y auditoría de firmware |

---

## Próximos Pasos y Documentación Técnica

- **[Arquitectura detallada del sistema](docs/architecture.md)** — Modelo relacional de datos, flujos entre subsistemas y garantías de aislamiento.
- **[Matriz de compatibilidad OLT](docs/compatibility-matrix.md)** — Catálogo completo de OIDs, niveles de severidad y referencias técnicas.
- **[Pruebas de laboratorio sin hardware](docs/testing-without-hardware.md)** — Guía para inyectar trampas SNMP y simular incidentes ópticos.
- **[Procedimiento operativo de contingencia (SOP)](docs/operations/pilot-sop-and-fallback.md)** — Procedimientos manuales para el operador cuando el análisis cognitivo no está activo.
- **[Evolución hacia AIOps cognitivo](docs/aiops-roadmap.md)** — Hoja de ruta sobre modelos multivariados y correlación topológica.

---

## Licencia

Propietario — todos los derechos reservados. Copyright © 2026 TecnoDespegue / René Kuhm.

Este repositorio **no** está bajo una licencia de código abierto. El acceso público se concede exclusivamente para revisión técnica y evaluación. No puede ser copiado, modificado, comercializado ni redistribuido sin autorización previa y por escrito. Consultar [`LICENSE`](LICENSE).
