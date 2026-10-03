# Changelog — FTTH-Copilot

All notable changes to FTTH-Copilot are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
with semantic versioning and per-change author attribution from commit messages.

---

## [0.2.2] — 2026-09-20 — Sesiones de escritorio sobre HTTP local

### Fixed

- Corregido el bucle de inicio de sesión del `.deb` cuando el backend local usa `http://localhost:3001`.
- Añadido `SESSION_COOKIE_SECURE` para desactivar explícitamente `Secure` solo en el runtime HTTP local.
- Conservadas las cookies `Secure` por defecto en producción y en despliegues HTTPS.

## [0.2.1] — 2026-09-20 — Corrección de distribución multiplataforma

> **Estado del producto:** patch release de corrección para la distribución multiplataforma.

### Fixed

- Alineadas las versiones de los paquetes, Tauri, Cargo, Android, health endpoint y telemetría a `0.2.1`.
- Corregidos los nombres de los instaladores generados para que coincidan con el release.
- Añadido un chequeo automático para detectar divergencias de versión antes de publicar.
- Actualizada la documentación de distribución para Android, Linux y Windows.

### Known limitations

- El APK publicado continúa siendo unsigned y los instaladores de escritorio no tienen firma de código.
- `v0.2.0` conserva sus assets históricos; este patch release entrega artefactos corregidos.

### Verification

- Check de versión, lint, typecheck, build web, 378 tests y `cargo check` verificados localmente.
- Los builds Android y multiplataforma completos quedan sujetos al CI por requerir Java, SDK Android y runners nativos.

## [0.1.1] — 2026-09-19 — Corrección del demo Docker

> **Estado del producto:** patch release de v0.1.0. Mantiene el alcance de evaluación técnica.

### Fixed

- Corregido el build del runner al eliminar la copia de un directorio `public` inexistente.
- Añadido pnpm al runner para ejecutar migraciones y seed dentro de Docker.
- Corregido el launcher del demo para generar `.env` desde el template correctamente.
- Corregidos los servicios de migración y seed para usar el workspace y el script oficial de base de datos.

### Verification

- Docker build, 21 migraciones, seed de 810 muestras y 4 alertas, health check HTTP y CI completo verificados.

## [0.1.0] — 2026-09-20 — Primer lanzamiento

> **Estado del producto:** v0.1.0 es un lanzamiento de evaluación técnica.
> No es producción listo sin un piloto autorizado y los gates de aceptación validados.
> Consultá [Límites conocidos](#known-limits-v010) abajo.

### Added

#### Organic Diagnostic Router — Adaptive Routing Engine
- **Block 1** (`agent-core`): Instrumentación de costo LLM y latencia por tool call (`latencyMs`, `tokensPrompt`, `tokensCompletion`).
- **Block 2** (`eval`): Arnés de clasificación de intención con corpus de 30+ casos cubriendo 7 superficies (`user-message`, `conversation-history`, `tool-args`, `connector-payload`, `retrieval-block`, `system-assembly`, `prediction-provider`). Accuracy ≥ 0.95, false-routings = 0.
- **Block 3** (`agent-core/diagnostic-router`): Router con confianza gategated. Tres modos: `direct` (0 LLM calls), `assisted` (1–2 LLM calls), `investigation` (hasta 6 LLM calls). Conservative ceiling a gate ≥ 0.7, safe floor a gate < 0.3.

#### Cognitive Investigation Engine
- Motor de hechos determinísticos y motor de investigación cognitiva (`packages/agent-core/investigation-engine.ts`).
- Validador de hechos contra evidencia cruda (`investigation-validator.ts`).
- Evidence collector para investigación cognitiva (Fase 3.2).
- Investigación enriquecida con topología temporal, correlación por tiempo, y afectados/conocidos-sanos.

#### Evidence System (TruthGate)
- Normalización de evidencias crudas con sobres de procedencia (`evidence.provenance.v1`).
- TruthGate en modo `observe` y `strict` (Fase B/C).
- Abstención verificable: el sistema se niega a responder cuando la evidencia no alcanza en lugar de inventar.
- Contratos Zod canónicos (`@ftth-copilot/shared`).

#### SNMP Monitoring Pipeline
- Receptor binario SNMP UDP con deduplicación y guard.
- **8 adapters L2** (Huawei, ZTE, Nokia, FiberHome, Calix, Adtran, VSOL, BDCOM) + Standard RFC.
- **64 definiciones formales**, **69 OIDs únicos**, **0 colisiones semánticas**.
- Catálogo OID, parser, extractor IF-MIB, sanitizador.
- Laboratorio de conformidad sin hardware con golden snapshots y property-based tests (ASN.1).

#### Detection Engine (`@ftth-copilot/detection`)
- `detectLosEvents` — detección de pérdida de señal (LOS counter rising).
- `detectSignalDrift` — predicción de cruce de umbral RX (–27 dBm) con R² mínimo.
- `detectTemperatureDrift` — predicción de temperatura OLT (60 °C shutdown).
- `detectOpticalDegradation` — bias current y temperatura ONT.
- `detectRebootStorm`, `detectBaselineAnomaly`, `detectFecDegradation`, `detectFlapping`, `detectTrafficAnomaly`.

#### Conectores NMS
- **SmartOLT** (`connectors-smartolt`): Cliente HTTP nativo, mock con fixtures de 42 ONUs y 5 OLTs. Fix case-insensitive OLT IDs (#204).
- **Mikrowisp** (`connectors-mikrowisp`): Cliente HTTP nativo con mock.
- **MikroTik RouterOS v7** (`connectors-mikrotik`): REST API + fallback binaria, cifrado AES-256-GCM de credenciales, health check.

#### Canales de alerta
- **Prometheus Exporter** (`/api/metrics`): Métricas de proceso, OLT, SNMP, tokens LLM, fallback, latencia RAG, dispatch del router.
- **Telegram, Slack (Block Kit), WhatsApp**: Despacho HTTP autenticado con formateadores enriquecidos.
- **Webhook** genérico.

#### UI — Canvas Components
- `IncidentsCanvas`: Mapa visual de incidentes por severidad y tiempo.
- `InvestigationCanvas`: Panel de investigación cognitiva.
- Smart-pack layout con breakpoints de densidad.

#### Observabilidad
- **Arize Phoenix** (OpenInference / OpenTelemetry): Trazas para `agent.run`, `llm.*`, `retrieval.*`, `tool.*`, `investigation.engine`. Redactor estricto de secretos.
- Métricas Prometheus exportadas con autenticación Bearer opcional.

#### Instalación y despliegue
- `install.sh`: Instalador interactivo de producción (Linux/macOS, Docker).
- `docker-compose.prod.yml`: Stack de producción con postgres, migrate, app.
- `docker-compose.demo.yml`: Demo completo con datos sintéticos y cuenta demo.
- `scripts/run-demo.sh`: Launcher de un comando para el demo.
- Bootstrap reproducible con health check.

#### Seguridad
- Aislamiento multi-tenant desde el día 1 (schema Prisma, JWT sessions revocables, PostgreSQL).
- Cifrado AES-256-GCM de claves API NMS con `KMS_MASTER_KEY`.
- SSRF protection: DNS lookup contra IPs privadas y metadatos de nube.
- Rate limiting atómico en PostgreSQL (por usuario/minuto y cuota diaria).
- Redaction de secretos en trazas OpenInference.

#### Documentación
- `docs/product-wedge.md`: Definición del wedge de producto (offline-ONU + fault de fibra).
- `docs/quickstart.md`: Guía de inicio rápido en 3 paths (Docker, pnpm, producción).
- `docs/walkthrough.md`: Guion escrito del demo con evidencia capturada.
- `docs/benchmarks.md`: Métricas documentadas (latencia, SNMP p95, accuracy, alert FP).
- `docs/architecture.md`: Arquitectura completa del sistema.
- `docs/conformance-benchmark.md`: Benchmark SNMP con resultados reproducibles.
- `docs/security-audit.md`: Auditoría de seguridad.

### Fixed

- SmartOLT OLT IDs case-insensitive (`83155a0`).
- SNMP socket leak y bound revival on immediate stop (`#179`).
- SNMP ready rejection on bind error, deduplication, sync snmp bound state (`#178`).
- Hardened SNMP receiver lifecycle y web coverage thresholds (`#177`).
- Web test integration in CI, sandboxed SNMP test (`#176`).
- Canvas bugs, security vulnerabilities, chat error sanitization (`#175`).
- Bootstrap: setup CLI collision, health endpoint, env vars alignment (`#171`).
- Production installer: compose interpolation, fail-closed, seed authorization (`#181`, `#182`).
- Provisional trap suppression en producción (`#167`, `#166`, `#165`).
- HTTP header-style sensitive keys redaction (`#193`).

### Security

- Claves API NMS cifradas en PostgreSQL (AES-256-GCM derivado de `KMS_MASTER_KEY`).
- Fail-closed si `KMS_MASTER_KEY` no está configurada en producción.
- Sesiones JWT revocables con invalidación atómica en PostgreSQL.
- `ALLOW_PRODUCTION_SEED=false` por defecto; seed explícitamente autorizado en bootstrap.
- No se commitean credenciales reales en el historial (sanitización documentada).

### Technical debt

- Monorepo pnpm con 16 workspaces.
- 378 tests unitarios (Vitest), 253 tests de evaluación, tests E2E (Playwright).
- Cobertura de tests: thresholds enforced in CI.
- PR template, issue templates, maintenance window issue template.
- OpenSpec pipeline para cambios de arquitectura.
- OpenInference / OpenTelemetry instrumentation sin runtime overhead en producción.

---

## [0.0.0] — 2026-XX-XX — Pre-release

No hay releases formales anteriores a 0.1.0. El repositorio fue desarrollado iterativamente sin tags de versión.

---

## Upgrade notes

### Desde pre-release → 0.1.0

**Nuevo archivo obligatorio:** `.env.prod` (producción) o `.env` (desarrollo).

Variables requeridas nuevas en 0.1.0:

```bash
# Auth (generar con: openssl rand -hex 32)
JWT_SECRET=<32-byte-secret>
KMS_MASTER_KEY=<32-byte-secret>

# Demo
DEMO_MODE_ENABLED=true   # desarrollo/demo; false en producción
```

Variables removidas de `.env.example` (ya no se usan):
- Ninguna.

**Breaking changes:** no hay. 0.1.0 es backward-compatible con cualquier configuración de desarrollo previa.

---

## Known Limits — v0.1.0

| Limitación | Descripción | Mitigación |
|---|---|---|
| **Sin SNMP en tiempo real en el wedge** | El receptor UDP SNMP existe pero no está incluido en la primera historia de producto. | SNMP trap ingestion es candidate para v0.2.0 |
| **Sin OLTs físicos validados** | Los 8 adapters L2 están testeados en laboratorio sin hardware real. | Piloto con OLTs autorizados requerido para promoción L2 → L3 |
| **Sin caso de éxito de producción** | No hay ISP en producción validando el wedge de offline-ONU. | Piloto ≥ 14 días, ≥ 50 casos adjudicados antes de claim de producción |
| **Precision TBD** | La precisión de afirmación factual (`computePrecision`) requiere labels del técnico NOC. | Fase F decisión #6: labels_csv pendiente |
| **Costos LLM aproximados** | Los costos por investigación son estimados ($0.012 USD/inv) y varían según provider y modelo. | Medir con `PHOENIX_COLLECTOR_ENDPOINT` activo |
| **MikroTik connector en beta** | La integración MikroTik fue mergeada en `#189` pero no tiene piloto. | Usar con precaución; no en producción aún |
| **Sin multi-idioma** | La UI y los diagnósticos están en español; no hay i18n. | Roadmap i18n pendiente |
| **Base de datos PostgreSQL 16** | No se probado con PostgreSQL 15 o 14. | Usar PostgreSQL 16+ |
| **Docker required para producción** | No hay path de deployment sin Docker. | Kubernetes/Helm roadmap pendiente |
| **NetSense no soportado** | El conector NetSense está en roadmap pero no integrado. | No usar con NetSense; la API rechaza conexiones |
| **SIN RE-MEDIACIÓN AUTOMÁTICA** | FTTH-Copilot no ejecuta cambios sobre la infraestructura. | Nunca — la plataforma mantiene al operador en control |

---

## Pilot gates (para promoción a producción)

```
Aceptación de piloto = TRUE si:
  hard_safety_passed      = true       (0 cross-tenant leaks, 0 NMS unauthorized, 0 non-existent refs)
  diagnostic_accuracy      >= 0.80     (≥ 80% de diagnósticos correctos adjudicados)
  supported_claims_ratio   >= 0.90     (≥ 90% de afirmaciones respaldadas por evidencia)
  alert_false_positive    < 0.05      (< 5% de alertas son falsos positivos)
  latency_p95_ms           < 15000     (< 15s p95 de investigación)
  duration_days            >= 14       (≥ 14 días de operación)
  adjudicated_cases       >= 50       (≥ 50 casos adjudicados)
```

Consultá [`docs/validation/fase-7-pilot-report.md`](docs/validation/fase-7-pilot-report.md) para el detalle completo de los gates.
