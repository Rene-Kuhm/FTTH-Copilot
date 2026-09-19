# FTTH-Copilot

## Diagnóstico de fibra para ISPs — impulsado por IA

**Diagnóstico offline-ONU · Deriva óptica predictiva · Conectores SmartOLT / Mikrowisp · Evidencia verificable**

![FTTH-Copilot convierte telemetría de red en evidencia operativa para equipos NOC](docs/assets/ftth-copilot-hero.png)

> **From network data to operational evidence.**

FTTH-Copilot responde la pregunta que un operador NOC tiene cada noche a las 2 AM:
*¿Cuáles ONUs se fueron offline, por qué, y qué hago ahora?*

Conecta SmartOLT o Mikrowisp, detecta ONUs offline y señales en degradación, y presenta
un diagnóstico verificable — no una intuición. El operador mantiene el control: la plataforma
investiga, explica y prioriza; no ejecuta cambios sobre la infraestructura.

## Promesa de producto (v0.1.0)

**FTTH-Copilot le dice a un operador NOC cuáles ONUs están offline o degradándose,
por qué, y cuál es el siguiente paso — verificado contra datos crudos de
SmartOLT o Mikrowisp, no una suposición.**

| | |
|---|---|
| **A quién va dirigido** | Ingeniero NOC o técnico de planta de un ISP FTTH que opera SmartOLT o Mikrowisp |
| **Qué resuelve** | Identificación rápida de ONUs offline, correlación de patrones de corte, predicción de fibra a punto de caer |
| **Qué NO hace (v0.1.0)** | No ingiere traps SNMP en tiempo real · No detecta intrusiones SOC · No hace auditoría de firmware · No automatiza remediation |
| **Métrica de éxito** | Un evaluador configura el entorno demo y llega a un diagnóstico funcional en ≤ 5 minutos sin credenciales reales |

> [!NOTE]
> La plataforma incluye capacidades NOC/AIOps, SOC, SNMP multi-vendor y más
> (ver secciones debajo). El primer mensaje público se enfoca en el diagnóstico
> offline-ONU porque es lo que un ISP puede evaluar inmediatamente.
> Consultá [`docs/product-wedge.md`](docs/product-wedge.md) para el alcance técnico completo.

---

## ¿Querés evaluar FTTH-Copilot en tu ISP?

> **v0.1.0 es un lanzamiento de evaluación técnica.**
> No requiere inversión en hardware, contratos ni integraciones complejas para comenzar.

### Evaluadores ISP

1. **Levantá el demo** → `./scripts/run-demo.sh` (sin credenciales, 3 min)
2. **Viste el video** → [37s demo en video](docs/assets/ftth-copilot-demo-16x9.mp4)
3. **Pedí una sesión técnica** → contactá al equipo para walkthrough guiado con tus escenarios

### Para equipos de ingeniería que evaluan integración

- [Documentación técnica completa](docs/architecture.md)
- [Benchmarks reproducibles](docs/benchmarks.md)
- [Guía de despliegue en producción](docs/production-deployment.md)
- [Roadmap público](ROADMAP.md) con estado actual y siguientes pasos validados

### Modelo de licenciamiento

FTTH-Copilot es **software propietario**. El acceso público es para evaluación técnica;
no otorga derecho a copiar, modificar o redistribuir sin autorización escrita.

| Escenario | ¿Qué podés hacer? |
|---|---|
| Evaluar en tu entorno | ✅ Usar el demo, leer el código, correr los tests |
| Integrar en tu ISP | ✅ Con licencia escrita de TecnoDespegue |
| Forkear o modificar | ❌ Requiere autorización previa |
| Reducir a producción | ❌ Requiere licencia comercial + validación de piloto |

Consultá [`LICENSE`](LICENSE) para los términos completos.

### Contacto y soporte

| Canal | Uso |
|---|---|
| **Demo y evaluación** | Usá el demo público arriba |
| **Sesión técnica guiada** | Abrí un issue con la etiqueta `evaluation` o contactá directamente |
| **Bug report** | [`SECURITY.md`](SECURITY.md) para vulnerabilidades; issue normal para bugs |
| **Roadmap y producto** | Issues con etiqueta `enhancement` |
| **Contribuir código** | Leé [`CONTRIBUTING.md`](CONTRIBUTING.md) primero |

---

## Por qué FTTH-Copilot

En un NOC tradicional, la información necesaria para resolver un incidente suele quedar fragmentada entre el NMS, las series temporales, las alarmas, la topología y el conocimiento del operador. El problema no es la falta de datos: es el tiempo y la carga cognitiva necesarios para convertirlos en una decisión defendible.

FTTH-Copilot preserva la evidencia original, separa los hechos de las hipótesis y aplica controles de calidad antes de presentar un diagnóstico. El operador obtiene una ruta de investigación auditable sin ceder el control de la red ni habilitar remediaciones opacas.

## Capacidades principales

| Capacidad | Valor operativo |
|---|---|
| **Organic Diagnostic Router — adaptive routing engine** | Selecciona el camino mínimo viable (`direct`, `assisted` o `investigation`) según la intención, el alcance y la evidencia necesaria. |
| **NOC y AIOps predictivo** | Detecta deriva óptica y térmica, estima tiempo hasta degradación y correlaciona incidentes por topología y tiempo. |
| **Telemetría OLT multi-vendor** | Normaliza traps SNMP v1/v2c/v3 mediante perfiles auditados para 12 fabricantes y dos interfaces estándar. |
| **SOC perimetral** | Analiza syslog, correlaciona accesos anómalos y registra vulnerabilidades de firmware con trazabilidad por tenant. |
| **Evidence-first diagnostics** | Conserva procedencia, frescura y calidad de cada señal; TruthGate rechaza afirmaciones que la evidencia no sostiene. |
| **Automatización e integración** | Conecta SmartOLT, Mikrowisp y MikroTik, y entrega alertas mediante webhooks, Telegram, Slack y WhatsApp. |

## Del dato a la decisión

```text
OLT / NMS / Syslog
        │
        ▼
Telemetría y evidencia normalizada
        │
        ▼
Detección NOC/SOC + Organic Diagnostic Router
        │
        ▼
Diagnóstico verificable + siguiente acción para el operador
```

La plataforma mantiene a la persona en el circuito: investiga, explica y prioriza; no ejecuta cambios sobre la infraestructura física. Consultá la [arquitectura completa](docs/architecture.md), la [matriz OLT](docs/compatibility-matrix.md) y el [roadmap público](ROADMAP.md) para conocer el alcance y los límites actuales.

---

## Quick Path (Inicio Rápido)

### 0. Demo en 3 comandos (sin instalar nada)

¿Querés evaluar FTTH-Copilot ahora mismo? Levantá un entorno completo con datos sintéticos y una cuenta demo en menos de un minuto:

```bash
# 1. Descargá y ejecutá el launcher (crea .env, compila, levanta todo)
./scripts/run-demo.sh

# 2. Esperá a que termine de compilar (~2 min la primera vez)
#    Cuando veas " ✓ app", abrí http://localhost:3001

# 3. Iniciá sesión con las credenciales de demo:
#    Email:    admin@ftth-copilot.local
#    Password: demo12345
```

El demo incluye:
- **5 OLTs** con escenarios variados (1 con temperatura alta)
- **~42 ONUs** (4 offline, 1 degradada, resto online)
- **Alertas tempranas** en el dashboard
- **NMS mock** de SmartOLT — sin credenciales reales

Para detener: `./scripts/run-demo.sh down`. Para reiniciar desde cero: `./scripts/run-demo.sh reset`.

### 0b. Ver el walkthrough en video (37 s)

El video muestra dos casos del Organic Diagnostic Router funcionando contra datos sintéticos:

**[▶ Ver demo (37 s, 16:9)](docs/assets/ftth-copilot-demo-16x9.mp4)**

- **Caso 1 — DIRECT:** consulta de estado de OLT → 0 llamadas LLM, respuesta en 3 ms
- **Caso 2 — INVESTIGATION:** diagnóstico de caída de RX → 4 tool calls, TruthGate activa la abstención

Consultá [`docs/walkthrough.md`](docs/walkthrough.md) para el guion escrito con la evidencia capturada.

> [!TIP]
> Si preferís levantar los servicios manualmente:
> ```bash
> cp docs/demo-env-template.md .env  # luego copiá el bloque ```bash ``` a .env
> docker compose -f docker-compose.demo.yml up
> ```

### 1. Entorno de Desarrollo (Local)

**Requisitos previos:** Node.js 22+, pnpm 11+, PostgreSQL 16+ (o Docker para levantarlo automáticamente).

```bash
# 1. Instalar dependencias del monorepo
pnpm install

# 2. Asistente interactivo (configura .env, genera claves KMS/JWT, migra y siembra la base)
pnpm run setup   # o también: pnpm bootstrap

# 3. Iniciar servidor de desarrollo en http://localhost:3001
pnpm dev
```

> [!TIP]
> Para entornos de integración continua o inicializaciones automatizadas sin terminal interactiva, ejecutá:
> ```bash
> pnpm run setup -- --non-interactive # o pnpm run setup -- -y
> ```

**Credenciales iniciales de desarrollo:**

| Parámetro | Valor por defecto | Notas |
|---|---|---|
| **URL Acceso** | `http://localhost:3001` | Interfaz web de chat y tableros NOC/SOC |
| **Organización (Tenant)** | `Demo ISP` (`demo-tenant`) | Entorno multi-tenant preconfigurado |
| **Email Administrador** | `admin@ftth-copilot.local` | Usuario administrador inicial |
| **Contraseña** | Generada en consola | Impresa durante `pnpm run setup` (o variable `SEED_ADMIN_PASSWORD`) |

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
| **1. Copiloto Conversacional** | Diagnósticos interactivos sobre el estado de ONUs, causas de offline y consultas NMS. Despacha cada consulta al modo mínimo viable (`direct` / `assisted` / `investigation`). | APIs de SmartOLT y Mikrowisp | `/app` (Chat UI) y `/api/chat` |
| **2. NOC & AIOps Cognitivo** | Predicción de derivas ópticas, cálculo de ETA a corte y formulación de hipótesis raíz. | Series temporales (potencia RX, temp) y topología | `/dashboard` (Fallas) y `/api/predictions` |
| **3. SOC Seguridad Perimetral** | Detección de ataques de fuerza bruta, accesos tras fallos y auditoría de firmware con CVEs. | Receptor Syslog UDP (5514) e inventarios | `/dashboard` (Accesos) y `/api/security/access` |
| **4. Telemetría SNMP** | Ingestión binaria de trampas físicas de OLTs con deduplicación y token bucket. | Receptor SNMP UDP (162/1162) v1/v2c/v3 | Ingesta de bajo nivel y catálogo OID |

---

## Copiloto Conversacional: Organic Diagnostic Router

El **Organic Diagnostic Router — adaptive routing engine** clasifica cada consulta del operador y elige el nivel de razonamiento necesario sin convertir una búsqueda puntual en una investigación costosa.

Cada consulta del operador se clasifica en uno de tres modos de despacho. El modo determina **cuántas llamadas al LLM** se hacen y **qué subconjunto de herramientas** recibe el modelo.

| Modo | Llamadas LLM | Iteraciones máx. | Herramientas | Cuándo se usa |
|---|---|---|---|---|
| `direct` | **0** | 0 | 1 (la más específica) | Una sola herramienta responde la consulta. Ej.: `estado de ONU-342`, `potencia RX de ONU-342` |
| `assisted` | **1** (o 2 si la primera emite tool call) | 1 | 2–4 | Pregunta con device ID, o consulta histórica. Ej.: `qué pasó ayer con ONU-342?` |
| `investigation` | **hasta 6** | 6 | todas | Multi-device, análisis de causa raíz, advisory. Ej.: `caída progresiva en 28 ONUs, cuál es la causa raíz?` |

**Cómo se mide.** Cada `runAgent` expone un campo opcional `route` en `AgentResult` y un contador Prometheus `ftth_copilot_router_dispatches_total{mode="..."}` en `/api/metrics`. Esto permite comparar antes/después desde Grafana o cualquier scraper compatible.

**Por qué importa.** Una consulta que antes hacía `LLM → tool → LLM → tool → respuesta` puede resolverse como `tool → formatter`, sin invocación al LLM. Para una flota de decenas de operadores preguntando por estado y potencia, el ahorro de tokens es medible desde el primer día.

---

## Matriz de Compatibilidad OLT (12 Fabricantes + Interfaces Estándar)

El catálogo unifica **12 fabricantes de OLT con PEN IANA** más **2 interfaces estándar** (Standard RFC 2863 IF-MIB y Generic ITU-T G.984/G.988 xPON), conformando **14 perfiles auditados**, **64 definiciones formales** y **69 OIDs únicos** libres de colisiones semánticas. Las fuentes autorizadas y licencias se gestionan individualmente en [`research/olt/<fabricante>/sources.yaml`](research/olt/).

| Fabricante / Perfil | PEN IANA | Nivel de Soporte | Estado Operativo | Familias Validadas en Laboratorio |
|---|---|---|---|---|
| **Huawei** | 2011 | L2 Adapter | Integrado en runtime | MA5600, MA5800 |
| **ZTE** | 3902 | L2 Adapter | Integrado en runtime | C300, C600 |
| **Nokia** | 637 / 6527 | L2 Adapter | Integrado en runtime | 7360 ISAM, Lightspan FX |
| **FiberHome** | 3807 | L2 Adapter | Integrado en runtime | AN5516, AN6000 |
| **Calix** | 1251 | L2 Adapter | Integrado en runtime | E7-2, AXOS series |
| **Adtran** | 664 | L2 Adapter | Integrado en runtime | Total Access 5000 (TA5000) |
| **VSOL** | 37950 | L2 Adapter | Integrado en runtime | V1600G series |
| **BDCOM** | 3320 | L2 Adapter | Integrado en runtime | P3600, GP3600 |
| **Standard RFC** | 0 | L2 Adapter | Integrado en runtime | RFC 2863 IF-MIB (linkUp, linkDown) |
| **Generic xPON** | 0 | L2 Adapter | Integrado en runtime | Interfaz ITU-T G.984 / G.988 genérica |
| **C-Data** | 34592 | L1 Definition | Bloqueado / Espera de hardware | FD1100, FD1200, FD1600 (MIB auditada) |
| **DZS** | 368 | L1 Definition | Bloqueado / Espera de hardware | V5800, V8100 series (MIB auditada) |
| **Ubiquiti** | 41112 | L1 Definition | Bloqueado / Espera de hardware | UFiber OLT, UFiber OLT 4 (MIB auditada) |
| **Zyxel** | 890 | L1 Definition | Bloqueado / Espera de hardware | OLT1404A, OLT1408A, OLT2406 (MIB auditada) |

> [!NOTE]
> - **L2 Adapter**: decodificador activo en el receptor SNMP UDP (`packages/monitoring`), con suites de pruebas unitarias, simulación y golden snapshots.
> - **L1 Definition**: fuentes y MIBs auditadas en [`research/olt/`](research/olt/), a la espera de hardware físico o capturas de laboratorio para elevación a L2.
> - Podés consultar la matriz canónica y criterios de conformidad en [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md).

---

## Conectores, Canales de Alerta y Estado de Integración

Para evitar ambigüedades entre código empaquetado y capacidades activas en producción, el estado operativo de cada componente se define explícitamente:

### 1. Conectores NMS y Red
- **SmartOLT:** **Integrado en runtime.** Cliente HTTP nativo de producción (`packages/connectors/smartolt`), validado con fixtures y conectado a `/api/chat` y dashboards.
- **Mikrowisp:** **Integrado en runtime.** Cliente HTTP nativo de producción (`packages/connectors/mikrowisp`), validado con fixtures y conectado a `/api/chat` y dashboards.
- **MikroTik RouterOS v7:** **Integrado en runtime.** Cliente REST API con fallback a API binaria (puerto 8728), conectado a `/api/connectors`, persistencia cifrada en PostgreSQL (AES-256-GCM derivado de KMS), health check y UI de configuración (`@ftth-copilot/connectors-mikrotik`, PR #189).
- **NetSense:** **Pendiente en roadmap.** La API rechaza explícitamente la conexión sin sustituir datos con mocks silenciosos.

### 2. Canales de Notificación y Alertas
- **Webhooks & Telegram:** **Integrados en runtime.** Despacho automático de alertas tempranas e incidentes cognitivos por tenant vía `packages/alerts`.
- **Slack (Block Kit):** **Integrado en runtime.** Formateador de payloads con bloques enriquecidos, barras de color por severidad y despacho HTTP en el runner de alertas por tenant en Next.js (`@ftth-copilot/alerts`, PR #189).
- **WhatsApp (Evolution / Z-API / Cloud API):** **Integrado en runtime.** Formateador de texto Markdown para mensajería y despacho HTTP autenticado en el runner de alertas por tenant en Next.js (`@ftth-copilot/alerts`, PR #189).

### 3. Observabilidad y Métricas
- **Prometheus Exporter (`/api/metrics`):** **Integrado en runtime.** Endpoint HTTP en Next.js (`apps/web/app/api/metrics/route.ts`) que expone métricas de proceso, OLT, SNMP, LLM tokens, fallback de proveedores, latencia RAG y dispatch del Organic Diagnostic Router (`ftth_copilot_router_dispatches_total{mode="..."}`) en formato estándar de Prometheus (`text/plain; version=0.0.4; charset=utf-8`). Soporta autenticación Bearer opcional mediante `METRICS_BEARER_TOKEN`.
- **Phoenix LLM Tracing (OpenInference):** **Integrado en runtime.** Instrumentación OpenInference / OpenTelemetry de cadenas cognitivas (`agent.run`, `llm.*`, `retrieval.*`, `tool.*`, `investigation.engine`), redactor estricto de secretos y exportador OTLP (`POST /v1/traces`) a Arize Phoenix vía `PHOENIX_COLLECTOR_ENDPOINT` (PR 3).

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
| **NOC Poller & Métricas** | `METRICS_POLLER_ENABLED`, `METRICS_POLL_INTERVAL_MS`, `METRICS_RETENTION_DAYS`, `METRICS_BEARER_TOKEN` | Intervalo y retención de series temporales; autenticación Bearer para `/api/metrics` (Prometheus) |
| **NOC Alertas** | `ALERT_WEBHOOK_URL`, `ALERT_COOLDOWN_MS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Despacho de incidentes predictivos por Webhook o Telegram |
| **SOC Syslog** | `SYSLOG_RECEIVER_ENABLED`, `SYSLOG_UDP_PORT`, `SYSLOG_TENANT_ID` | Receptor y analizador UDP de eventos de red |
| **SOC Firmware** | `FIRMWARE_AUDIT_ENABLED`, `FIRMWARE_AUDIT_INTERVAL_MS` | Auditoría de versiones con vulnerabilidades y CVEs conocidas |
| **Red NMS** | `NMS_REQUEST_TIMEOUT_MS`, `NMS_ALLOWED_HOSTS`, `NMS_ALLOW_PRIVATE_NETWORKS` | Políticas de egreso y seguridad perimetral |
| **Inferencia LLM** | `LLM_PROVIDER`, `MINIMAX_API_KEY`, `DEEPSEEK_API_KEY`, `QWEN_API_KEY` | Proveedores de lenguaje natural y llaves de inferencia |


---

## Comandos de Verificación y Testing

### 1. Validación General del Monorepo
```bash
pnpm lint                  # Análisis estático ESLint en los 16 workspaces
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
| [`packages/agent-core`](packages/agent-core) | Motor cognitivo con Organic Diagnostic Router: clasifica la consulta en `direct` / `assisted` / `investigation`, despacha herramientas y decide cuándo llamar al LLM |
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

## Arquitectura Visual

El flujo completo del sistema está disponible como un diagrama interactivo generado y validado con Archify:

**[Abrir diagrama interactivo de arquitectura](docs/architecture/ftth-copilot-architecture.html)**

El mapa muestra el recorrido desde el operador y el dashboard Next.js hasta el runtime cognitivo, los conectores NMS, PostgreSQL, la ingesta SNMP/syslog, evidencia y analítica, detección, alertas, canales NOC/SOC, proveedores LLM y trazas Phoenix. Incluye vistas enfocadas para:

- **Request and diagnosis:** consulta del operador y diagnóstico contra la red.
- **Telemetry and evidence:** ingreso de señales, normalización, persistencia y trazabilidad.
- **Detection and response:** correlación, severidad y despacho operativo.

La especificación fuente (`ftth-copilot.architecture.json`) queda junto al HTML para permitir regeneración y revisión técnica.

## Próximos Pasos y Documentación Técnica

- **[Guía de inicio rápido](docs/quickstart.md)** — Llegá a un diagnóstico funcional en 5 minutos o menos, con opciones de demo (Docker), desarrollo local (pnpm) y producción (install.sh).
- **[Benchmarks documentados](docs/benchmarks.md)** — Latencia de diagnóstico, rendimiento SNMP, accuracy del classifier, y métricas de piloto.
- **[Caso de estudio reproducible](docs/case-study-synthetic.md)** — 4 escenarios de diagnóstico reproducibles paso a paso con datos sintéticos y métricas observadas.
- **[Changelog](CHANGELOG.md)** — Histórico de cambios, features, fixes, límites conocidos y notas de upgrade de v0.1.0.
- **[Guía de despliegue en producción](docs/production-deployment.md)** — Backup, restore, observabilidad (Prometheus, Phoenix), seguridad y runbook de emergencia.
- **[Secret scan y rotación de credenciales](docs/secret-scan.md)** — Hallazgos de auditoría, estado del `.gitignore`, procedimientos de rotación, y acciones pendientes.
- **[Plan de distribución](docs/distribution.md)** — Comunidades objetivo, mensajes de outreach, checklist de launch, y tracking de conversión demo→contacto.
- **[Roadmap público](ROADMAP.md)** — Estado actual, validación pendiente y evolución prevista del producto.
- **[Arquitectura detallada del sistema](docs/architecture.md)** — Modelo relacional de datos, flujos entre subsistemas y garantías de aislamiento.
- **[Matriz de compatibilidad OLT](docs/compatibility-matrix.md)** — Catálogo completo de OIDs, niveles de severidad y referencias técnicas.
- **[Pruebas de laboratorio sin hardware](docs/testing-without-hardware.md)** — Guía para inyectar trampas SNMP y simular incidentes ópticos.
- **[Procedimiento operativo de contingencia (SOP)](docs/operations/pilot-sop-and-fallback.md)** — Procedimientos manuales para el operador cuando el análisis cognitivo no está activo.
- **[Evolución hacia AIOps cognitivo](docs/aiops-roadmap.md)** — Hoja de ruta sobre modelos multivariados y correlación topológica.

## Contribuciones y Seguridad

- Consultá [`CONTRIBUTING.md`](CONTRIBUTING.md) antes de proponer cambios. El repositorio es propietario y cualquier contribución requiere coordinación previa con el propietario.
- Para reportar una vulnerabilidad, seguí el proceso de divulgación privada de [`SECURITY.md`](SECURITY.md). No publiques información sensible en un issue.

---

## Licencia y términos

**Proprietario — todos los derechos reservados.** Copyright © 2026 TecnoDespegue / René Kuhm.

| Uso | Permitido |
|---|---|
| Lectura y revisión técnica | ✅ Sí |
| Evaluación con el demo público | ✅ Sí |
| Fork para evaluación interna | ✅ Sí (revisión limitada) |
| Uso en producción | ❌ Requiere licencia escrita |
| Modificación o derivados | ❌ Requiere autorización previa |
| Redistribución | ❌ Prohibido sin autorización |

**Para solicitar una licencia de uso o una sesión técnica:** abrí un issue con la etiqueta `evaluation` o contactá directamente. El proceso de evaluación empieza con el demo público; no se requiere contacto previo para evaluar.

Consultá [`LICENSE`](LICENSE) para los términos legales completos y [`CONTRIBUTING.md`](CONTRIBUTING.md) para el proceso de contribución.
