<a id="top"></a>

<div align="center">
  <img src="docs/assets/ftth-copilot-hero.png" width="1000" alt="FTTH-Copilot — de la telemetría de la red a evidencia operativa para equipos NOC">
</div>

<h1 align="center">FTTH-Copilot</h1>

<p align="center"><strong>Diagnóstico de fibra verificable para ISPs FTTH.</strong></p>

<p align="center">
  <a href="https://github.com/Rene-Kuhm/FTTH-Copilot/releases/latest"><img src="https://img.shields.io/github/v/release/Rene-Kuhm/FTTH-Copilot?style=for-the-badge&labelColor=0B2239&color=85BBF0" alt="Última versión"></a>
  <a href="https://github.com/Rene-Kuhm/FTTH-Copilot/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Rene-Kuhm/FTTH-Copilot/ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=0B2239&color=85BBF0" alt="Estado de CI"></a>
  <a href="https://github.com/Rene-Kuhm/FTTH-Copilot/actions/workflows/eval-nightly.yml"><img src="https://img.shields.io/github/actions/workflow/status/Rene-Kuhm/FTTH-Copilot/eval-nightly.yml?branch=main&style=for-the-badge&label=eval&labelColor=0B2239&color=85BBF0" alt="Evaluación adversarial nocturna"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Proprietary-85BBF0?style=for-the-badge&labelColor=0B2239" alt="Licencia propietaria"></a>
  <a href="https://github.com/Rene-Kuhm/FTTH-Copilot/commits/main"><img src="https://img.shields.io/github/last-commit/Rene-Kuhm/FTTH-Copilot?style=for-the-badge&labelColor=0B2239&color=85BBF0" alt="Último commit"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-22%2B-5FA04E?style=for-the-badge&labelColor=0B2239" alt="Node.js 22 o superior">
  <img src="https://img.shields.io/badge/pnpm-11-F9D3C4?style=for-the-badge&labelColor=0B2239" alt="pnpm 11">
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&labelColor=0B2239" alt="TypeScript 5.7 estricto">
  <img src="https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&labelColor=0B2239" alt="Next.js 16">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&labelColor=0B2239" alt="PostgreSQL 16">
</p>

<p align="center">
  <strong>
    <a href="#que-hace">Qué hace</a>
    &nbsp;·&nbsp;
    <a href="#como-funciona">Cómo funciona</a>
    &nbsp;·&nbsp;
    <a href="#plataforma">La plataforma</a>
    &nbsp;·&nbsp;
    <a href="#empezar">Empezar</a>
    &nbsp;·&nbsp;
    <a href="#documentacion">Documentación</a>
  </strong>
</p>

<br>

<p align="center">La telemetría de tu red no llega como respuestas: llega como evidencia.<br><strong>FTTH-Copilot convierte SmartOLT, Mikrowisp, MikroTik, traps SNMP y syslog en un diagnóstico que un operador puede defender.</strong></p>

<div align="center">
  <h3>🎬 Verlo en acción</h3>

  <p>
  Dos casos del Organic Diagnostic Router contra datos sintéticos: 37 segundos, sin credenciales reales.
  </p>

  <video controls width="820" poster="docs/assets/ftth-copilot-hero.png" src="docs/assets/ftth-copilot-demo-16x9.mp4"></video>

  <p>
  <a href="docs/assets/ftth-copilot-demo-16x9.mp4">▶ Abrir el video (MP4)</a> &nbsp;·&nbsp;
  <a href="docs/walkthrough.md">Leer el guion escrito</a>
  </p>
</div>

<p align="center"><strong>PLATAFORMA NOC/SOC</strong> &nbsp;·&nbsp; Evidencia primero &nbsp;·&nbsp; Multi-tenant &nbsp;·&nbsp; SNMP multi-vendor &nbsp;·&nbsp; Shadow mode</p>

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

<a id="novedades"></a>

## ✨ Novedades en v0.7

La [release v0.7.0](https://github.com/Rene-Kuhm/FTTH-Copilot/releases/tag/v0.7.0) separa el trabajo de fondo del proceso web, y la v0.7.1 lo valida en staging:

- **El worker es el único dueño del trabajo de fondo.** *Breaking change:* el modo `embedded` se eliminó. Todo despliegue necesita el worker y Redis; `BACKEND_MODE=embedded` impide que la web arranque. Un deploy de la web ya no corta el monitoreo, y el tier web escala en horizontal sin duplicar trabajo. [Runbook](docs/how-to/desplegar-en-produccion.md).
- **El health de la web lista los loops del worker.** El endpoint de salud enumera los loops esperados y los receptores vigilados por su socket, y no se degrada tras un reinicio del worker.
- **Salvaguardas de la Fase 1 antes de aprender.** El learning loop verifica suficiencia de muestra y split temporal *antes* de congelar un dataset por tenant.
- **Un staging reproducible.** Levanta el entorno completo desde cero, con su base, sus migraciones y sus datos de prueba.
- **Rate limiter global con Redis.** Cuota por usuario y por minuto, atómica y compartida entre instancias, con respaldo en memoria.
- **Una sola tabla de version carriers.** La versión vive en un único lugar y los portadores se sincronizan desde ahí.

> El historial completo está en [`CHANGELOG.md`](CHANGELOG.md). Las entradas se generan con [release-please](https://github.com/googleapis/release-please) a partir de los Conventional Commits de `main`.

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

<a id="que-hace"></a>

## 🎯 Qué hace

Responde la pregunta que un operador NOC tiene cada noche a las 2 AM: *¿Cuáles ONUs se fueron offline, por qué, y qué hago ahora?*

| | |
|---|---|
| **Estado de adopción** | Una empresa ya lo está probando |
| **A quién va dirigido** | Ingeniero NOC o técnico de planta de un ISP FTTH que opera SmartOLT, Mikrowisp o MikroTik |
| **Qué resuelve** | Identificación de ONUs offline, correlación de patrones de corte, predicción de fibra a punto de caer |
| **Qué NO hace** | No ejecuta cambios sobre la red · No es un reemplazo del NMS · No certifica todavía ninguna familia OLT en hardware real · No automatiza remediación |
| **Métrica de éxito** | Un evaluador configura el entorno demo y llega a un diagnóstico funcional en ≤ 5 minutos, sin credenciales reales |

| Capacidad | Valor operativo |
|---|---|
| **Laya Decision Layer** ([ADR-042](docs/engineering/ADR-042-laya-decision-layer.md)) | Expert System de clasificación de eventos FTTH: 9 clases, 94,4% de accuracy en `eventClass`, menos de 5 ms, sin GPU. Corre en shadow mode: registra su decisión antes de influir en el routing. |
| **Organic Diagnostic Router** | Elige el camino mínimo viable —`direct`, `assisted` o `investigation`— según la intención, el alcance y la evidencia necesaria. Una consulta puntual paga 0 llamadas al LLM. |
| **NOC y AIOps predictivo** | Detecta deriva óptica y térmica con detectores puros (mediana + MAD), estima el tiempo hasta degradación y correlaciona incidentes por topología y tiempo. |
| **Telemetría OLT multi-vendor** | Normaliza traps SNMP v1/v2c/v3 mediante adaptadores por familia: 17 fabricantes catalogados, 94 familias de hardware, 92 fuentes documentadas y 152 hechos OID verificados. |
| **SOC perimetral** | Analiza syslog RFC 3164/5424, correlaciona accesos anómalos y registra vulnerabilidades de firmware con trazabilidad por tenant. |
| **Evidence-first diagnostics** | Conserva procedencia, frescura y calidad de cada señal; el TruthGate rechaza las afirmaciones que la evidencia no sostiene. Abstener es un resultado correcto. |
| **Autenticación enterprise y MFA** | LDAP/Active Directory con mapeo de grupos a roles, OIDC documentado y TOTP por usuario. |
| **Alertas multicanal** | Webhooks, Telegram, Slack (Block Kit), WhatsApp y Ntfy push, con deduplicación, cooldown y escalado por severidad. |

> [!NOTE]
> El producto tiene tres planos —copiloto conversacional, NOC/AIOps y SOC perimetral— sobre una sola base multi-tenant. El primer mensaje público se enfoca en el diagnóstico offline-ONU porque es lo que un ISP puede evaluar de inmediato. El alcance técnico completo está en [`docs/product-wedge.md`](docs/product-wedge.md).

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

<a id="como-funciona"></a>

## 🧠 Cómo funciona

### Evidencia primero — De la telemetría al diagnóstico

<img width="100%" src="docs/architecture/c4/views/dataflow.svg" alt="Flujo de datos: de las fuentes a la evidencia, a los tres planos de producto y a la salida">

La evidencia original se preserva, los hechos se separan de las hipótesis y los controles de calidad se aplican antes de presentar un diagnóstico. El operador recibe una ruta de investigación auditable, no una caja negra.

Cuatro invariantes atraviesan todo el sistema, y romperlas no es una cuestión de estilo: es un defecto.

| Invariante | Qué significa en código |
|---|---|
| **Tenant-aware** | Toda consulta, evento, clave de caché y referencia persistida lleva `tenantId`. No hay datos compartidos entre ISPs. |
| **Evidence first** | TruthGate rechaza afirmaciones que la evidencia no sostiene; abstener es un resultado válido, no un fallo. |
| **Fail-open** | Si Laya no responde, el pipeline continúa. Si el LLM falla, hay fallback. La degradación se registra, no se esconde. |
| **Shadow mode first** | Laya decide, pero solo registra hasta que la accuracy medida justifique que influya en el routing. |

**[Documento →](docs/explanation/evidencia-y-truth-gate.md)**

---

### Contexto de sistema

<img width="100%" src="docs/architecture/c4/views/context.svg" alt="Vista C4 de contexto: FTTH-Copilot y los sistemas externos que lo rodean">

El sistema se apoya en lo que el ISP ya tiene: SmartOLT, Mikrowisp, MikroTik, un OLT que emite traps SNMP y el firewall que emite syslog. No reemplaza al NMS — lo consume. Lo único que agrega es la capa que convierte esas señales en un diagnóstico con procedencia.

La arquitectura es **código**: un único modelo C4 en [`docs/architecture/c4/model.d2`](docs/architecture/c4/model.d2) del que salen las cuatro vistas que se renderizan en CI. Si el modelo cambia y las vistas no, el build falla.

**[Documento →](docs/architecture.md)**

---

### Contenedores — 24 workspaces, dependencias hacia abajo

<img width="100%" src="docs/architecture/c4/views/container.svg" alt="Vista C4 de contenedores: dónde vive cada capa del monorepo">

El monorepo es un workspace de pnpm con Turborepo: `apps/*`, `packages/*`, `packages/connectors/*` y `services/*`. Los paquetes se organizan en capas y **solo se importan hacia abajo**.

| Límite | Regla |
|---|---|
| **Dependencia** | Un paquete importa de su propia capa o de una inferior. Nunca hacia arriba, nunca en círculo. `apps/web` es el único que conoce a todos. |
| **Contratos** | Los esquemas Zod canónicos viven en `packages/shared`. Un tipo duplicado en dos paquetes es un bug, no una conveniencia. |
| **Detección** | `detection` y `security` exponen funciones **puras**: sin I/O, sin base, sin hora del sistema. Eso es lo que las hace testeables y auditables. |
| **Conectores** | Ningún adaptador habla directo con la base. Pasa por `connectors-core`, que es donde vive la política SSRF. |
| **Acceso a datos** | `db` es el único que conoce Prisma y el KMS. El resto consume el cliente tipado. |
| **Modelo de IA** | `agent-core` es el único que llama al LLM. Ningún endpoint de `apps/web` arma su propio prompt. |

<details>
<summary><kbd>Ver</kbd> <strong>Los 24 workspaces y su responsabilidad</strong></summary>

<br>

| Workspace | Capa | Responsabilidad |
|---|---|---|
| `apps/web` | L5 | Next.js App Router: chat con IA, tableros NOC/SOC, endpoints REST, middleware de sesión, E2E Playwright. |
| `packages/eval` | L4 | Arnés de evaluación estricto (attack-pass-rate 100%) y corpus adversarial con tenants piloto. |
| `packages/agent-core` | L3 | Motor cognitivo: Organic Diagnostic Router, motor de investigación, registro de herramientas (10 tools NMS), prompts, cliente LLM con cadena de fallback, trazas OTLP. |
| `packages/soc` | L3 | Orquestación perimetral, correlación de accesos anómalos, auditoría de firmware con trazabilidad por tenant. |
| `packages/monitoring` | L3 | Receptor binario SNMP, adaptadores OLT multi-fabricante, decodificación multi-vendor, catálogo OID, laboratorio de conformidad. |
| `packages/analytics` | L2 | Ingesta, agregación y persistencia de series temporales de fibra (potencia, temperatura, FEC). |
| `packages/alerts` | L2 | Deduplicación, agrupamiento, cooldown, escalado y despacho a Webhooks, Telegram, Slack, WhatsApp y Ntfy. |
| `packages/db` | L1 | Esquema Prisma, cliente tipado, migraciones y cifrado KMS (AES-256-GCM) derivado de `KMS_MASTER_KEY`. |
| `packages/evidence` | L1 | Normalización de evidencia cruda, sobres de investigación, procedencia y frescura. |
| `packages/learning` | L1 | Núcleo puro del learning loop: resolución de etiquetas, agrupación en eventos, split temporal y suficiencia de muestra. |
| `packages/connectors/smartolt` | L1 | Adaptador SmartOLT: cliente HTTP de producción y fixtures de laboratorio. |
| `packages/connectors/mikrowisp` | L1 | Adaptador Mikrowisp: cliente HTTP de producción y fixtures de laboratorio. |
| `packages/connectors/mikrotik` | L1 | Adaptador MikroTik RouterOS v7 (REST con fallback a API binaria 8728), credenciales cifradas en PostgreSQL. |
| `packages/shared` | L0 | Contratos canónicos Zod, esquemas compartidos, tipos de telemetría, cliente Laya y Expert System. |
| `packages/connectors/core` | L0 | Tipos canónicos de NMS y políticas estrictas de seguridad SSRF (allowlists, rangos privados, metadatos de nube). |
| `packages/detection` | L0 | Algoritmos estadísticos puros (mediana + MAD) para deriva óptica y térmica. |
| `packages/security` | L0 | Analizador RFC 3164/5424 de paquetes syslog y clasificadores de ataques. |

Los workspaces restantes —`api-contract`, `ingest`, `investigations`, `jobs`, `scheduler`, `connectors/factory` y `services/worker`— completan el contrato de API, la ingesta durable, el motor de investigación, la cola de jobs, la planificación, la selección de adaptadores y el proceso de trabajo de fondo.

</details>

**[Documento →](ARCHITECTURE.md)**

---

<a id="copiloto-conversacional-organic-diagnostic-router"></a>

### Organic Diagnostic Router — Cuánto razona

El router clasifica cada consulta y decide **cuántas llamadas al LLM** se hacen y **qué herramientas** recibe el modelo. Antes de razonar, consulta a **Laya Decision Layer**, que clasifica el evento FTTH en menos de 5 ms y sin GPU.

```mermaid
flowchart LR
    Q["Consulta del operador"] --> L{"Laya<br/>9 clases · shadow mode"}
    L -->|"POWER_FAULT"| ROUTER{"Clasificación de intención"}
    L -->|"NORMAL"| SKIP["Se ignora"]
    L -->|"OPTICAL_FAULT"| ROUTER
    L -->|"CONGESTION"| ROUTER
    L -->|"UNKNOWN"| ROUTER

    ROUTER -->|"un dispositivo"| D["direct<br/>0 llamadas LLM · 1 herramienta"]
    ROUTER -->|"histórico"| A["assisted<br/>1 llamada LLM · 2-4 herramientas"]
    ROUTER -->|"causa raíz"| I["investigation<br/>hasta 6 llamadas LLM · todas las herramientas"]

    D --> G["TruthGate"]
    A --> G
    I --> G
    G --> OUT["Diagnóstico verificable"]
```

| Modo | Llamadas LLM | Iteraciones máx. | Herramientas | Cuándo se usa |
|---|---|---|---|---|
| `direct` | **0** | 0 | 1 (la más específica) | Una sola herramienta responde la consulta. Ej.: `estado de ONU-342`. |
| `assisted` | **1** (o 2 si la primera emite tool call) | 1 | 2–4 | Pregunta con device ID, o consulta histórica. Ej.: `qué pasó ayer con ONU-342?` |
| `investigation` | **hasta 6** | 6 | todas | Multi-device, análisis de causa raíz, advisory. |

**Modos de Laya.** `shadow` (default) consulta al servicio y registra la decisión sin cambiar la ruta. `assisted` deja que la señal influya en el routing dentro de los umbrales de confianza. `automatic` permite que Laya elija la ruta. Los modos `assisted` y `automatic` necesitan `LAYA_URL` alcanzable; sin él, Laya degrada en fail-open y registra `fallback`.

**Cómo se mide.** Cada `runAgent` expone un campo `route` en `AgentResult` y un contador `ftth_copilot_router_dispatches_total{mode="..."}` en `/api/metrics`.

**[Documento →](docs/explanation/routing-y-laya.md)**

---

### TruthGate — Abstenerse es un resultado

El TruthGate es el último filtro. Una afirmación que la evidencia no sostiene no se muestra, no se suaviza y no se completa con suposiciones: el sistema se abstiene. Cada diagnóstico expone de dónde salió cada hecho, qué tan fresco es y qué calidad tiene.

Es la diferencia entre un copiloto que convence y uno que se puede auditar. Un operador que no puede explicar por qué el sistema dijo lo que dijo no lo va a usar en un incidente real.

**[Documento →](docs/explanation/evidencia-y-truth-gate.md)**

---

### Medido — Lo que los números dicen hoy

Las cifras salen del laboratorio y del conformance suite, no de una promesa.

| Métrica | Valor | Condición | Umbral |
|---|---|---|---|
| **Tool call en modo `direct`** | **3 ms** | Fixture SmartOLT mock | 0 llamadas al LLM |
| **Latencia p95 SNMP** | **1,33 ms** | UDP loopback, conformance lab | < 50 ms ✅ |
| **Throughput SNMP sostenido** | **845 events/sec** | UDP loopback, conformance lab | > 100 events/sec ✅ |
| **Drops bajo carga sostenida** | **0** | UDP loopback, conformance lab | 0 requeridos ✅ |
| **Precisión del clasificador de intención** | **≥ 0.95** | 253 tests | ≥ 0.95 ✅ |
| **Cobertura de detección** | **8/8** fault types | Tests pasando | 8/8 ✅ |
| **Afirmaciones sostenidas por evidencia** | **Sin medir en campo** | Test de umbral con datos de prueba | ≥ 90% |
| **Falsos positivos de alerta** | **Sin medir en campo** | Test de umbral con datos de prueba | < 5% |
| **Exactitud diagnóstica en campo** | **TBD** | Sin medir todavía | — |
| **Reducción de esfuerzo del operador** | **TBD** | Sin medir todavía | — |
| **Tiempo hasta la resolución** | **TBD** | Sin medir todavía | — |

Las tres últimas filas son las que más importan y todavía no tienen número. Una empresa ya está probando la plataforma, pero esa prueba todavía no produjo estas mediciones; el repo las marca como *TBD* en lugar de inventar una cifra. El harness adversarial corre todas las noches en CI con un gate de attack-pass-rate 100%.

**[Documento →](docs/benchmarks.md)**

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

<a id="plataforma"></a>

## 🖥️ La plataforma

Los tres planos comparten **una sola base multi-tenant**: no son aplicaciones separadas.

| Plano | Qué resuelve | Superficie operativa |
|---|---|---|
| **Copiloto conversacional** | Diagnósticos interactivos sobre estado de ONUs, causas de offline y consultas NMS. | `/app` (chat) y `/api/chat` |
| **NOC y AIOps cognitivo** | Predicción de derivas ópticas, cálculo de ETA a corte, hipótesis raíz. | `/dashboard` (Fallas) y `/api/predictions` |
| **SOC perimetral** | Detección de fuerza bruta, accesos tras fallos, auditoría de firmware con CVEs. | `/dashboard` (Accesos) y `/api/security/access` |

<img width="100%" src="docs/assets/ftth-copilot-metrics-dashboard.png" alt="Tablero de métricas de FTTH-Copilot: solicitudes totales, rendimiento del LLM y distribución del routing">

---

<a id="conectores-canales-de-alerta-y-estado-de-integración"></a>

### Conectores y canales de alerta

| Conector | Estado | Nota |
|---|---|---|
| **SmartOLT** | Integrado en runtime | API REST de producción y fixtures de laboratorio. |
| **Mikrowisp** | Integrado en runtime | API REST de producción y fixtures de laboratorio. |
| **MikroTik** | Integrado en runtime | RouterOS v7 por REST, con fallback a la API binaria 8728. |
| **NetSense** | Pendiente en roadmap | La API rechaza explícitamente la conexión sin sustituir datos con mocks silenciosos. |

| Canal | Estado | Nota |
|---|---|---|
| **Webhooks** | Integrado en runtime | Despacho automático de alertas tempranas e incidentes por tenant. |
| **Telegram** | Integrado en runtime | Despacho por bot token y chat id. |
| **Slack (Block Kit)** | Integrado en runtime | Bloques enriquecidos con barras de color por severidad. |
| **WhatsApp** | Integrado en runtime | Evolution / Z-API / Cloud API, texto Markdown y dispatch HTTP autenticado. |
| **Ntfy (self-hosted)** | Integrado en runtime | POST REST a `{serverUrl}/{topic}` con prioridad y tags. Sin Firebase ni costos. |

### Telemetría SNMP multi-vendor

El catálogo de compatibilidad OLT es un artefacto **generado**: [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md) se reconstruye desde `research/olt/` con `pnpm generate:matrix:write`, y CI falla si deriva.

| Métrica | Valor |
|---|---|
| Fabricantes registrados | 17 |
| Familias de hardware | 94 |
| Fuentes documentadas | 92 |
| Hechos OID verificados | 152 |
| Familias en L1 (documentadas) | 72 |
| Familias en L2 (simuladas) | 22 |
| Familias en L3 / L4 (certificadas con hardware) | 0 / 0 — pendientes de la fase de validación |

Los decodificadores activos viven en `packages/monitoring/src/snmp/adapter/`: adaptadores por familia (Huawei, ZTE, Nokia, FiberHome, Calix, Adtran, VSOL, BDCOM, DZS, Ubiquiti), los perfiles estándar (RFC 2863 IF-MIB y xPON genérico ITU-T G.984/G.988) y el baseline open para equipos sin MIB público.

**[Documento →](docs/compatibility-matrix.md)**

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

<a id="3-observabilidad-y-métricas"></a>

## 📈 Observabilidad y métricas

| Pieza | Qué expone | Dónde |
|---|---|---|
| **Métricas Prometheus** | Proceso, SNMP, LLM, RAG, dispatches del router, decisiones de Laya | `/api/metrics` → scrape de VictoriaMetrics (`:8428`, VMUI incluida) |
| **VictoriaMetrics + reglas** | 8 recording rules y 7 alerting rules: caída de scrape, reinicios, caída del proveedor LLM de respaldo, colapso del modo `investigation` (>80% durante 15 min) | `docker/victoriametrics-alerts.yml`, evaluadas por VictoriaMetrics single-node o por el sidecar `vmalert` del stack de producción |
| **Phoenix LLM Tracing (OpenInference)** | Trazas de `agent.run`, `llm.*`, `retrieval.*`, `tool.*` e `investigation.engine`, con redactor estricto de secretos, exportadas como OTLP JSON a Arize Phoenix | `packages/agent-core/src/telemetry/` · exportador OTLP propio (sin SDK `@opentelemetry`) · `PHOENIX_COLLECTOR_ENDPOINT` |
| **Auditoría** | Registro de consultas, decisiones y evaluaciones | `packages/db` + `/dashboard` |

La UI de métricas en `/dashboard/metrics` muestra solicitudes totales, rendimiento del LLM, distribución de routing (direct / assisted / investigation) y la distribución de las 9 clases de decisión de Laya.

**[Documento →](docs/reference/configuracion.md)**

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

<a id="control"></a>

## 🛡️ Control

FTTH-Copilot mantiene a la persona en el circuito: **investiga, explica y prioriza; no ejecuta cambios sobre la infraestructura física.** No hay escrituras activas sobre la red —ni remediación SNMP, ni comandos a la OLT— y no las habrá sin una aprobación de diseño explícita.

| Control | Comportamiento |
|---|---|
| **Cifrado en reposo** | Claves de API y credenciales NMS con AES-256-GCM derivado de `KMS_MASTER_KEY`. En producción falla el arranque sin esa clave (`fail-closed`). |
| **Autenticación revocable** | Sesiones JWT en cookies `HttpOnly`, con invalidación y revocación atómica en PostgreSQL. |
| **Protección de costos LLM** | Rate limiter atómico en PostgreSQL por usuario y minuto, con cuota diaria estricta compartida entre instancias. |
| **Protección SSRF en NMS** | Validación previa de DNS contra IPs privadas y metadatos de nube. Las excepciones LAN requieren opt-in explícito. |
| **Protección de base de datos** | El seed rechaza ejecutarse en producción salvo autorización explícita (`ALLOW_PRODUCTION_SEED=true` o flag `--force`). |
| **Aislamiento por tenant** | `tenantId` obligatorio en consultas, eventos, claves de caché y referencias persistidas. |
| **Modo demo** | `DEMO_MODE_ENABLED=true` solo en evaluación. La UI y el copiloto advierten que los datos son sintéticos. En producción debe permanecer en `false`. |

### Lo que este repositorio no toca sin una decisión explícita

| Superficie | Por qué está protegida | Cómo se verifica |
|---|---|---|
| `packages/db/prisma/migrations/` | Se aplican con `db:deploy` en producción y en CI. Editar una migración aplicada rompe el despliegue. | `pnpm db:deploy` |
| `packages/db/src/generated/` | Cliente Prisma generado. No se edita a mano. | `pnpm db:generate` |
| `research/olt/` | Fuentes MIB auditadas con procedencia y licencia. | `pnpm check:sources` · `pnpm check:conflicts` |
| `docs/compatibility-matrix.md` | Generada desde las fuentes MIB. CI falla si deriva. | `pnpm generate:matrix:write` + `git diff --exit-code` |
| `packages/eval/` | Gate adversarial con attack-pass-rate 100%. Relajar una aserción equivale a borrar el gate. | `pnpm --filter @ftth-copilot/eval run test` |
| `packages/monitoring/tests/conformance/golden/` | Golden snapshots del laboratorio de conformidad. | `pnpm test:conformance` |
| `LICENSE` | Términos propietarios. | Revisión legal |

**[Documento →](SECURITY.md)**

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

<a id="caja"></a>

## 📦 También viene en la caja

| Componente | Qué hace |
|---|---|
| **Organic Diagnostic Router** | Decide cuánto razona el modelo por consulta: 0, 1 o hasta 6 llamadas al LLM. |
| **Laya Decision Layer** | Expert System de 9 clases que clasifica el evento FTTH en menos de 5 ms, sin GPU, en shadow mode por defecto. |
| **TruthGate** | Último filtro: rechaza afirmaciones que la evidencia no sostiene y admite la abstención. |
| **Receptor SNMP multi-vendor** | Traps binarios v1/v2c/v3, deduplicación y token bucket, con 152 hechos OID verificados. |
| **Conectores SmartOLT, Mikrowisp y MikroTik** | Lectura de inventario y estado de ONUs desde el NMS que el ISP ya opera. |
| **Alertas multicanal** | Webhooks, Telegram, Slack, WhatsApp y Ntfy con deduplicación, cooldown y escalado. |
| **SOC perimetral** | Analizador syslog RFC 3164/5424, correlación de accesos anómalos y auditoría de firmware con CVEs. |
| **Auth enterprise** | LDAP/AD con mapeo de grupos a roles, OIDC documentado y MFA TOTP por usuario. |
| **Observabilidad** | Prometheus, VictoriaMetrics con reglas de alerta y trazas OTLP a Arize Phoenix. |
| **Laboratorio de conformidad** | Golden snapshots y sockets UDP de loopback: el suite SNMP pasa sin equipo físico. |
| **Harness adversarial** | Corpus con tenants piloto y gate de attack-pass-rate 100%, corrido nightly en CI. |
| **Learning loop** | Resolución de etiquetas, agrupación en eventos, split temporal y congelación de dataset por tenant. |
| **Empaquetado multiplataforma** | Web/Docker, escritorio Linux y Windows, y APK Android. |
| **Staging reproducible** | Un entorno completo que se levanta desde cero, con su base y sus datos de prueba. |

**Cada componente, comando y variable: [Referencia completa →](docs/reference/linea-de-comandos.md)**

### Plataformas

| Plataforma | Artefactos | Estado |
|---|---|---|
| **Web / Docker** | `Dockerfile`, `docker-compose.demo/prod/https/staging.yml`, `install.sh` | Disponible para evaluación. |
| **Linux desktop** | `.deb` y AppImage | Generados y validados en CI. |
| **Windows** | `.msi` y `.exe` (NSIS) | Generados; ejecutados bajo Wine/Proton. |
| **Android** | APK debug y APK release sin firmar | Generado; unsigned, instalación manual. |

Los binarios se publican en [GitHub Releases](https://github.com/Rene-Kuhm/FTTH-Copilot/releases).

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

<a id="empezar"></a>

## ⚡ Empezar

**¿Cuál camino es el tuyo?**

| Si… | Usá |
| :--- | :--- |
| Querés ver el producto funcionando ya, sin credenciales reales | [Opción A — Demo con Docker](#opción-a--demo-con-docker-1-comando) |
| Vas a tocar código | [Opción B — Desarrollo local](#opción-b--desarrollo-local-3-comandos) |
| Vas a desplegarlo en un servidor | [Opción C — Producción](#opción-c--producción) |

### Opción A — Demo con Docker (1 comando)

Levanta el stack completo con datos sintéticos. Requisitos: Docker y Docker Compose, y los puertos 5432 y 3001 libres.

```bash
./scripts/run-demo.sh
```

Cuando veas `✓ app`, abrí `http://localhost:3001` e iniciá sesión con `admin@ftth-copilot.local` / `demo12345`.

Para detener: `./scripts/run-demo.sh down`. Para reiniciar desde cero: `./scripts/run-demo.sh reset`.

**[Guía →](docs/tutorials/tutorial-1-el-demo-en-un-comando.md)**

### Opción B — Desarrollo local (3 comandos)

**Requisitos:** Node.js 22+, pnpm 11+, PostgreSQL 16+ (o Docker para levantarlo automáticamente).

```bash
pnpm install        # 1. dependencias del monorepo
pnpm run setup      # 2. asistente interactivo: .env, claves KMS/JWT, migraciones y seed
pnpm dev            # 3. servidor de desarrollo en http://localhost:3001
```

`pnpm run setup` imprime la contraseña de administrador en consola. En CI o aprovisionamiento sin terminal: `pnpm run setup -- --non-interactive`.

Antes de abrir un PR: `pnpm typecheck && pnpm lint && pnpm test`.

**[Guía →](docs/tutorials/tutorial-3-entorno-local.md)**

### Opción C — Producción

```bash
./install.sh
```

Instalador interactivo: valida Docker, genera `.env.prod` con permisos `0600` y claves maestras de 32 bytes, compila la imagen Next.js standalone con usuario no privilegiado, aplica migraciones y valida `/api/health` con fallo estricto.

El runbook completo —despliegue, backup, restore, observabilidad y emergencia— está en [`docs/production-deployment.md`](docs/production-deployment.md).

**[Runbook →](docs/how-to/desplegar-en-produccion.md)**

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

<a id="documentacion"></a>

## 📚 Documentación

Empezá por el destino que necesitás y bajá a la referencia operativa solo cuando haga falta.

| Destino | Para qué |
| :--- | :--- |
| [Guía de inicio rápido](docs/quickstart.md) | Los tres entornos de ejecución, paso a paso. |
| [Modelo mental](docs/architecture.md) | Pipelines, entidades y ciclo de vida de una alerta. |
| [Mapa del repositorio](ARCHITECTURE.md) | Qué módulos existen, qué puede depender de qué y qué no se toca. |
| [Cómo funciona, explicado](docs/explanation/README.md) | Evidencia y TruthGate, routing y Laya, topología y tenants, ciclo de vida de alertas. |
| [Cómo hacer algo](docs/how-to/README.md) | Conectar un NMS real, habilitar NOC y SOC, desplegar en staging o producción, backup y restore, probar sin hardware, agregar un OLT nuevo, agregar un endpoint de API. |
| [Referencia](docs/reference/README.md) | Línea de comandos, configuración, modelo de datos, API HTTP, contenedores y CI, mapa de paquetes. |
| [Tutoriales](docs/tutorials/README.md) | El demo en un comando, tu primera consulta, el entorno local, tu primera investigación. |
| [Matriz de compatibilidad OLT](docs/compatibility-matrix.md) | Catálogo canónico de OIDs, perfiles por familia y niveles de conformidad. |
| [ADRs](docs/adr/README.md) | Las decisiones de arquitectura y por qué se tomaron. |
| [Contrato de API](docs/contract/openapi.yaml) | Especificación OpenAPI de los endpoints HTTP. |
| [Autenticación enterprise](docs/enterprise-auth.md) | LDAP/AD, OIDC, MFA TOTP y autenticación local. |
| [Despliegue en producción](docs/production-deployment.md) | Despliegue, backup, restore, observabilidad y runbook de emergencia. |
| [Pruebas sin hardware](docs/testing-without-hardware.md) | Cómo inyectar traps SNMP y simular incidentes ópticos sin OLT físico. |
| [Benchmarks](docs/benchmarks.md) | Latencia de diagnóstico, rendimiento SNMP y métricas de piloto. |
| [Auditoría de seguridad](docs/security-audit.md) | Registro técnico de la auditoría de seguridad. |
| [Roadmap público](ROADMAP.md) | Qué está *Current*, qué necesita *Validation*, qué viene *Next* y qué queda *Later*. |
| [Changelog](CHANGELOG.md) | Histórico de cambios, límites conocidos y notas de upgrade. |

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

<a id="comunidad"></a>

## 🤝 Comunidad

Este proyecto se construye en público. Traé un workflow real, una pregunta difícil, un bug o una mejora que le sirva a la próxima persona.

<p align="center">
  <a href="https://github.com/Rene-Kuhm/FTTH-Copilot/issues"><img src="https://img.shields.io/badge/Issues-abrir%20un%20tema-1168BD?style=for-the-badge&labelColor=0B2239" alt="GitHub issues"></a>
  <a href="https://github.com/Rene-Kuhm/FTTH-Copilot/graphs/contributors"><img src="https://img.shields.io/badge/Contributors-gracias-85BBF0?style=for-the-badge&labelColor=0B2239" alt="Contribuyentes"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/Changelog-historial-1168BD?style=for-the-badge&labelColor=0B2239" alt="Changelog"></a>
</p>

- Abrí un [issue](https://github.com/Rene-Kuhm/FTTH-Copilot/issues) con el contexto necesario para reproducir o entender la idea.
- Leé [`CONTRIBUTING.md`](CONTRIBUTING.md) antes de mandar cambios: Conventional Commits 1.0.0, commits atómicos y PRs chicas.
- Reportá una vulnerabilidad por el proceso de divulgación privada de [`SECURITY.md`](SECURITY.md). No publiques información sensible en un issue.

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

## Sobre el autor

FTTH-Copilot es obra de [René Kuhm](https://github.com/Rene-Kuhm), de TecnoDespegue. Creció de una convicción práctica: los agentes capaces son más útiles cuando la intención de la persona, la carga de revisión y el criterio de entrega siguen visibles durante todo el trabajo.

La plataforma mantiene esa línea hasta el final: el sistema investiga, explica y prioriza; la decisión operativa sigue siendo del operador.

<p align="center">
  <a href="https://github.com/Rene-Kuhm"><img src="https://img.shields.io/badge/GitHub-Rene--Kuhm-1168BD?style=for-the-badge&labelColor=0B2239" alt="GitHub de René Kuhm"></a>
  <a href="https://github.com/Rene-Kuhm/FTTH-Copilot/releases"><img src="https://img.shields.io/badge/Releases-instaladores-85BBF0?style=for-the-badge&labelColor=0B2239" alt="Releases"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Proprietary-85BBF0?style=for-the-badge&labelColor=0B2239" alt="Licencia propietaria"></a>
</p>

<p align="right"><a href="#top">Back to top ↑</a></p>

<p align="center">— ◆ —</p>

<p align="center"><strong>Software propietario. El acceso público es para evaluación técnica.</strong></p>

> **FTTH-Copilot es software propietario.** El acceso público es para evaluación técnica: leer el código, correr el demo y los tests, y solicitar una licencia escrita para uso en producción. No hay derecho a forkear, modificar ni redistribuir.
>
> El acceso público al repositorio no otorga ningún derecho sobre el software. Los términos completos están en [`LICENSE`](LICENSE). Para solicitar una licencia de uso, contactá al Owner.
