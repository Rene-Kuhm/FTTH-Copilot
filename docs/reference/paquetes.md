# Referencia de los paquetes internos

El workspace pnpm (`pnpm-workspace.yaml:1-4`) incluye `apps/*`, `packages/*` y
`packages/connectors/*`. **`services/` no es un workspace member**: `services/laya` es un
servicio Python con su propio `Dockerfile`.

## Mapa de dependencias

```
shared ──┬─► evidence ─┐
         │              │
         ├──► db ───────┤
         │              │
         ├──► connectors-core ──┬─► connectors-mikrotik
         │                      ├─► connectors-mikrowisp
         │                      └─► connectors-smartolt
         │
         ├──► detection ──► alerts ──► monitoring
         ├──► analytics ────────────┘   (monitoring)
         ├──► security ──► soc
         └──► agent-core ◄── eval
```

Dependencias exactas (del `dependencies` de cada `package.json`):

| Paquete | Depende de |
|---|---|
| `@ftth-copilot/shared` | `evidence` (**peer opcional**, rompe el ciclo) |
| `@ftth-copilot/evidence` | `shared` |
| `@ftth-copilot/db` | `shared` |
| `@ftth-copilot/detection` | — |
| `@ftth-copilot/alerts` | `db`, `detection` |
| `@ftth-copilot/analytics` | `connectors-core`, `db` |
| `@ftth-copilot/monitoring` | `alerts`, `analytics`, `connectors-core`, `shared` |
| `@ftth-copilot/security` | — |
| `@ftth-copilot/soc` | `alerts`, `connectors-core`, `db`, `security` |
| `@ftth-copilot/agent-core` | `connectors-core`, `connectors-smartolt`, `db`, `evidence`, `shared` |
| `@ftth-copilot/eval` | `agent-core`, `db`, `evidence`, `shared` |
| `@ftth-copilot/connectors-core` | — |
| `@ftth-copilot/connectors-mikrotik` | `connectors-core` |
| `@ftth-copilot/connectors-mikrowisp` | `connectors-core` |
| `@ftth-copilot/connectors-smartolt` | `connectors-core` |
| `@ftth-copilot/web` | todos los anteriores |

**Único ciclo**: `shared` ⇄ `evidence`. `shared/src/index.ts:4` importa **sólo tipos**
(`import type { Verdict, VerdictCode }`), que se borran al compilar; `evidence/src/index.ts:19`
reexporta un valor (`ABSTENTION_SCHEMA`). No hay ciclo de runtime, pero el grafo de paquetes
es un 2-ciclo y `shared/package.json:31` declara `evidence` como peer opcional para romperlo
en la instalación.

## 1. `@ftth-copilot/shared` — contratos y motor Laya

Único runtime dep: `zod`. `evidence` es peer opcional.

| Módulo | Responsabilidad |
|---|---|
| `src/contracts.ts` | Todos los schemas de wire en Zod: `evidence.provenance.v1`, `ftth.telemetry.v1`, `ftth.finding.v1`, `ftth.abstention.v1`, `ftth.investigation-result.v1`, `ftth.investigation-run.v1`, `ftth.investigation-version.v1`, `ftth.investigation-feedback.v1`, `ftth.confirmed-incident.v1`, `ftth.topology-edge.v1`, `ftth.topology-correlation.v1`, `ftth.tenant-policy.v1`, `ftth.verdict-log.v1`, `ftth.action.v1` |
| `src/laya-expert-system.ts` | `FTTHExpertClassifier`: clasificador rule-based de eventos de red en `EventClass` con severidad, scope probable y `requiresInvestigation` |
| `src/laya-shadow.ts` | Resolución de configuración (`LAYA_ENABLED`/`LAYA_MODE`/`LAYA_FAIL_OPEN`), umbrales y modo shadow |
| `src/laya-client.ts` | Cliente HTTP del microservicio, con circuit breaker y timeout |
| `src/laya-metrics.ts` | Contadores y latencias de Laya, y su formato Prometheus |
| `src/laya-integration.ts` | Puente entre el clasificador y el router adaptativo |
| `src/index.ts` | `AgentResult`, `ChatRequest`, `ChatResponse` y re-exports |

## 2. `@ftth-copilot/evidence` — capa de evidencia pura

Sin Prisma, sin DB. Deps: `shared`, `zod`.

| Módulo | Responsabilidad |
|---|---|
| `src/truth-gate.ts` | Clasificador de envelopes en 4 dimensiones: confianza, staleness, completitud. `classifyEnvelope`, `classifyUnwrapped`, `rankVerdicts` |
| `src/abstention-policy.ts` | `shouldAbstain(verdicts, mode)` y `buildAbstention(...)` |
| `src/evidence-collector.ts` | `collectInvestigationEvidence`: recolección tenant-scoped con ventana y tope de 64 refs |
| `src/relevant-incidents.ts` | Recuperación de incidentes confirmados como contexto de fondo |
| `src/bm25-lite.ts` | BM25 en memoria: `RRF_K=60`, `MIN_SPARSESCORE=0.05`, `DEVICE_HINT_BOOST=1.5` |
| `src/topology.ts` | Álgebra de topología: `bfsDownstream`, `bfsAncestors`, `topologyPath` |
| `src/topology-correlation.ts` | Correlación topológica con pesos aprendidos |
| `src/edge-identity.ts`, `src/groups-reconciler.ts` | Identidad de edges y reconciliación de grupos |
| `src/evidence-quality.ts` | Calidad de la evidencia recolectada |
| `src/pending-incident.ts` | Candidato de incidente pendiente |
| `src/investigation-enrichment.ts` | Enriquecimiento de una investigación |

## 3. `@ftth-copilot/db` — Prisma, auth y cripto

| Módulo | Responsabilidad |
|---|---|
| `src/client.ts` | Singleton de Prisma con cache en `globalThis` y auto-descubrimiento de `.env` |
| `src/auth.ts` | bcrypt (coste 12), JWT HS256 de 7 días, hash SHA-256 del token para la tabla `Session`, token temporal de MFA de 5 minutos |
| `src/cookies.ts` | Atributos de la cookie `ftth_session` (`httpOnly`, `sameSite:'lax'`, `secure` derivado) |
| `src/crypto.ts` | AES-256-GCM para las API keys de NMS en reposo |
| `src/auth-rate-limit.ts` | Cuota de fuerza bruta de ventana fija, con store inyectable para tests |
| `src/investigation-store.ts` | Versiones de investigación inmutables |

## 4. `@ftth-copilot/detection` — detectores puros

**Cero dependencias** (ni de workspace). Funciones puras sobre series temporales.

| Módulo | Señal |
|---|---|
| `src/stats.ts` | `median`, `mad`, `fitTrend`, `predictThresholdCrossing` |
| `src/signal-drift.ts` | Deriva de RX a la baja |
| `src/temperature-drift.ts` | Deriva de temperatura a la suba |
| `src/flapping.ts` | Conexión intermitente |
| `src/reboots.ts` | Tormenta de reinicios |
| `src/anomaly.ts` | Desviación contra la línea base (mediana + MAD) |
| `src/fec.ts` | Degradación de FEC |
| `src/optical.ts` | Degradación óptica (bias, temperatura de ONT) |
| `src/los.ts` | Eventos de pérdida de señal |
| `src/traffic.ts` | Anomalías de tráfico |

## 5. `@ftth-copilot/alerts` — ciclo de vida de la alerta

Deps: `db`, `detection`.

| Módulo | Responsabilidad |
|---|---|
| `src/runner.ts` | `runDetectors`: delega en `@ftth-copilot/detection` |
| `src/dedup.ts` | `findingKey` (`kind:deviceKind:deviceId`) y `reconcile`: dedup, cooldown, escalado, resolución |
| `src/group.ts` | `groupRows`: pivota filas planas de métricas en series por dispositivo |
| `src/correlate.ts` | `correlateAlerts`: agrupa alertas activas en incidentes cuando hay ≥2 kinds distintos |
| `src/manager.ts` | `runDetection`: orquestador que escribe en Prisma y notifica |
| `src/notify.ts` | Webhook, Telegram, Slack (Block Kit) y WhatsApp, con `fetchImpl` inyectable |
| `src/types.ts` | Tipos del dominio |

## 6. `@ftth-copilot/analytics` — muestreo, retención y anomalías

Deps: `connectors-core`, `db`.

| Módulo | Responsabilidad |
|---|---|
| `src/collect.ts` | `collectSamples`: muestrea un `INmsConnector` a `MetricPoint[]` |
| `src/ingest.ts` | `persistSamples` |
| `src/retention.ts` | `runRetention` |
| `src/sla.ts` | `computeUptime`: SLA por dispositivo |
| `src/anomaly.ts` | `robustZScore` (mediana/MAD con constante 0.6745), descomposición aditiva estacional, `detectAnomalies` + `groupAnomalies` |
| `src/correlation-score.ts` | `scoreSituation`, `extractFeatures`, `updateWeights` (logística con pesos aprendidos) |
| `src/scenario.ts`, `src/scheduler-helpers.ts` | Escenarios y helpers del scheduler |

## 7. `@ftth-copilot/monitoring` — SNMP y orquestación del poll

Deps: `alerts`, `analytics`, `connectors-core`, `shared`, `net-snmp`, `yaml`, `zod`.

| Módulo | Responsabilidad |
|---|---|
| `src/poll.ts` | `runPollCycle` / `pollConnections` |
| `src/snmp/catalog.ts` | `KNOWN_TRAP_DEFINITIONS`: catálogo de trampas conocidas |
| `src/snmp/parser.ts`, `decoder.ts`, `guard.ts` | Decodificación y validación de PDUs |
| `src/snmp/identity.ts` | `resolveDeviceIdentity` multi-fuente |
| `src/snmp/mapping.ts` | Mapeo de campos canónicos |
| `src/snmp/iana-pen.ts` | `IANA_VENDOR_REGISTRY` congelado, `resolveVendorByPen` |
| `src/snmp/adapter/contract.ts` | Interfaz `OltVendorAdapter` y `executeAdapterSafe` |
| `src/snmp/adapter/registry.ts` | `OltAdapterRegistry` y `defaultAdapterRegistry` |
| `src/snmp/adapter/*.ts` | `standard`, `huawei`, `zte`, `nokia`, `fiberhome`, `calix`, `adtran`, `vsol`, `bdcom`, `dzs`, `ubiquiti`, `generic-xpon`, `open-baseline` |
| `src/snmp/incident-linker.ts`, `evidence.ts` | Enlace a incidentes y evidencia |
| `src/snmp/receiver.ts` | Receptor UDP de trampas |
| `src/snmp/sanitizer.ts` | Saneado de capturas |
| `src/snmp/pipeline.ts` | `processSnmpNotification`: identidad → adapter → normalizar → errata → telemetría |
| `src/snmp/research/*` | Schema, validador, conflictos de OID y errata de las fuentes |
| `src/snmp/conformance/*` | Replay de conformidad y golden files |

## 8. `@ftth-copilot/security` — analítica de syslog

**Cero dependencias.**

| Módulo | Responsabilidad |
|---|---|
| `src/syslog.ts` | Parser RFC 3164 |
| `src/classify.ts` | `auth_failure` / `access` / `config_change` / `other` |
| `src/syslog-guard.ts` | Truncado y ventana de rate |
| `src/syslog-build.ts` | Construcción de mensajes |
| `src/detectors.ts` | `detectBruteForce`, `detectAccessAfterFailures`, `detectConfigChange` |
| `src/firmware.ts` | `detectVulnerableFirmware` |
| `src/traffic.ts` | `detectTrafficAnomaly` |
| `src/source-ip.ts` | Normalización de IP de origen |

## 9. `@ftth-copilot/soc` — servicio de operaciones de seguridad

Deps: `alerts`, `connectors-core`, `db`, `security`, `ldapts`.

| Módulo | Responsabilidad |
|---|---|
| `src/ingest.ts` | `ingestEvent`: syslog → `DeviceEvent` |
| `src/audit.ts` | `audit`, `auditAuth`, `auditIncident` y familia |
| `src/auth-ldap.ts` | Login LDAP/AD con `ldapts`, mapeo de grupos a roles |
| `src/notify.ts` | Enrutado de notificaciones con redacción de secretos |
| `src/run.ts` | `runSecurityDetection` + auditoría de firmware |
| `src/notification-deduper.ts` | Deduplicación de notificaciones |

## 10. `@ftth-copilot/agent-core` — runtime del agente

Deps: `connectors-core`, `connectors-smartolt`, `db`, `evidence`, `shared`,
`@anthropic-ai/sdk`, `openai`.

| Módulo | Responsabilidad |
|---|---|
| `src/runtime.ts` | `runAgent`: loop del agente, aplicación del TruthGate y del modo de abstención |
| `src/adaptive-router.ts` | `planRoute`, `selectMode`, `selectTools` — routing determinista en 3 modos |
| `src/diagnostic-router.ts` | Router de diagnóstico |
| `src/tools/index.ts` | `buildTools`, `executeToolCall` y construcción del envelope de procedencia |
| `src/tools/provenance.ts` | `PROVENANCE_TOOL_META`: metadatos de procedencia por tool |
| `src/investigation-engine.ts` | Motor de investigación: hechos deterministas, hipótesis, validación |
| `src/investigation-facts.ts` | `computeInvestigationFacts`: hechos puros (umbrales Rx −27 dBm crítico / −25 dBm warning) |
| `src/investigation-prompt.ts` | Versionado: `prompt-investigation@1.0.0`, `ruleset-investigation@1.0.0` |
| `src/investigation-validator.ts` | Re-validación del resultado contra el schema |
| `src/llm.ts` | Clientes estilo Anthropic y estilo OpenAI, con cadena de fallback |
| `src/prompts/system.ts` | Prompt de sistema |
| `src/telemetry/*` | Tracer, exportador OTLP, OpenInference y redacción de spans |
| `src/quality-bridge.ts`, `src/alerts.ts` | Puente de calidad y accesos a alertas |

## 11. `@ftth-copilot/eval` — harness de QA adversarial

| Módulo | Responsabilidad |
|---|---|
| `src/corpus-schema.ts`, `corpus-loader.ts` | Schema y carga del corpus |
| `src/runner.ts` | Runner; `runAgent` se **inyecta** como función, no se importa |
| `src/assertions.ts` | Aserciones de la corrida |
| `src/metrics.ts` | Métricas (pass rate, abstention rate, falsos positivos) |
| `src/verdict-log-writer.ts` | Persistencia del `verdict_log` |
| `src/labels-schema.ts`, `feedback-export.ts` | Labels y export de feedback |
| `src/intention-*.ts` | Clasificador, runner, schema y umbrales de intención |
| `src/pilot-*.ts` | Tenant, dataset congelado, métricas y gate de aceptación del piloto |

## 12. `@ftth-copilot/connectors-core` — contrato de NMS

**Sin dependencias.** Es la raíz del grafo de conectores.

- `src/index.ts`: interfaz `INmsConnector` y el modelo de dominio (`OltSummary`, `OltDetail`,
  `OnuSummary`, `OnuDetail`, `NetworkOverview`, `OdnTopologyGraph`, `PonTechnology`,
  `OpticalClass`).

  | Método | Devuelve |
  |---|---|
  | `ping()` | `{ok, latencyMs?, error?}` |
  | `listOlts()` | `OltSummary[]` |
  | `getOltDetail(oltId)` | `OltDetail` |
  | `getNetworkOverview()` | `NetworkOverview` |
  | `listOnus(filter?)` | `OnuSummary[]` |
  | `getOnuDetail(identifier)` | `OnuDetail \| null` |
  | `getOnusWithLowSignal(thresholdDbm)` | `OnuSummary[]` |
  | `searchByCustomerName(name)` | `OnuSummary[]` |
  | `listOnusByOlt?(oltId)` | `OnuDetail[]` (opcional) |

- `src/security.ts`: `assertSafeNmsBaseUrl`, `assertSafeNmsRequestUrl`, detección de IPs
  privadas y resolución DNS.

## 13. Conectores concretos

| Paquete | Módulo | Notas |
|---|---|---|
| `@ftth-copilot/connectors-smartolt` | `src/client.ts` | `SmartOltClient`; API key como header `X-Token` (`client.ts:81`) |
| `@ftth-copilot/connectors-mikrowisp` | `src/client.ts` | `MikrowispClient` |
| `@ftth-copilot/connectors-mikrotik` | `src/client.ts`, `src/adapter.ts` | `MikrotikNmsAdapter` sobre RouterOS REST; `parseMikrotikUptimeSeconds` |

Cada uno trae `src/fixtures.ts` (datos de demo) y `src/mock-nms.ts`.

## 14. `services/laya` — microservicio FastAPI

No es un paquete pnpm. Tres archivos: `app.py`, `Dockerfile`, `requirements.txt`
(fastapi, uvicorn, pydantic). Base `python:3.10-slim`, puerto 8080, healthcheck en `/health`.

| Endpoint | Qué hace |
|---|---|
| `GET /health` | Health del servicio |
| `POST /v1/decide` | Decide sobre un evento |
| `POST /v1/batch` | Decide sobre un lote |
| `GET /metrics` | Placeholder con ceros |

El docstring de `app.py:8-9` dice explícitamente que **la implementación primaria vive en
TypeScript** en `packages/shared/src/laya-expert-system.ts`: el servicio Python es un espejo
REST, no la fuente de verdad.

## 15. `apps/web` — la aplicación

Next.js 16 (App Router) con React 19. Consume **todos** los paquetes internos. Sus rutas
API están en `apps/web/app/api/**` (ver [Referencia de la API HTTP](api-http.md)).
