# FTTH-Copilot — Roadmap de integraciones pendientes

> **Qué es este documento:** el plan priorizado de TODO lo que falta integrar/implementar en FTTH-Copilot, ordenado por valor y por dependencias. Pensado para retomarlo día a día (cada item es accionable).
>
> **Estado (al 2026-09-05, actualizado):** las fases A–F del roadmap *evidence-first* **y los P1.2/P1.3/P1.4 + P2.1 + P2.2 de este roadmap** están **completos y mergeados a main** (CI 14/14 verde). Este documento empieza donde quedó: la deuda restante (P1.1) y los siguientes pasos de ingesta (P2.3+).
>
> **Fuente real de este roadmap:** `docs/aiops-roadmap.md`, `docs/evidence-first-roadmap.md`, deuda documentada de Fase F (`packages/eval`, `packages/security`, `packages/connectors`) y el estado verificado del repo (main `f2929a3`).

---

## Leyenda de prioridad

- 🔴 **P0 — Inmediato / deuda abierta:** cierres pendientes del trabajo ya entregado.
- 🟠 **P1 — Alto valor de detección:** lo que más mejora la utilidad para NOC/SOC.
- 🟡 **P2 — Integraciones de conectores / datos.**
- 🔵 **P3 — Escala / AIOps (solo cuando cruzan los gates numéricos).**

Cada item tiene: **objetivo**, **cómo**, **por qué importa**, **dependencia** y **criterio de "hecho"**.

---

## 🟠 P1 — Cerrar la deuda inmediata de Fase F (evaluación + SOC)

> Estado al 2026-09-04: **P1.2, P1.3 y P1.4 ya están SHIPPED**. Solo queda P1.1 (depende de humano).

### 1.1 Precision real de la evaluación (corpus etiquetado) — 🔵 PENDIENTE
- **Objetivo:** que `precision` deje de ser `'TBD'` y sea un número real en el reporte nightly.
- **Cómo:** el tech lead NOC etiqueta `docs/validation/labels.csv` (esquema ya listo: `case_id, factual_claim_supported, ground_truth_severity, labeled_by, labeled_at`).
- **Por qué importa:** sin ground truth, la métrica de precisión es cosmética; con ella, medimos si el agente "acierta" de verdad.
- **Criterio de hecho:** un run nightly emite `precision: <número>` (no `'TBD'`).
- **Dependencia:** humana (el etiquetador NOC).

### 1.2 Cablear `detectTrafficAnomaly` (SOC) a runtime — ✅ shipped (PR #80)
- **Objetivo:** activar el detector de anomalía de tráfico (throughput sostenido > umbral → posible CPE comprometido).
- **Cómo:** hoy está **implementado y testeado** (`packages/security/src/traffic.ts`) pero no conectado a datos reales en runtime.
- **Por qué importa:** es el detector SOC pendiente de cablear; cerrar el círculo de la detección.
- **Criterio de hecho:** el flujo SOC emite hallazgos `traffic_anomaly` cuando hay datos de tráfico.
- **Estado:** merged a main en `c08bca7` (PR #80, 2026-09-04), 14/14 CI verde.

### 1.3 Export dedicado de métricas (`injection_suspicion_total`) — ✅ shipped (PR #81)
- **Objetivo:** exponer el contador de sospechas de inyección como export/YAML accionable.
- **Cómo:** hoy se deriva en el job nightly desde `verdict_log` (diseño AD-11); falta un export dedicado.
- **Por qué importa:** dar visibilidad operativa al equipo de seguridad sobre intentos de inyección.
- **Criterio de hecho:** endpoint o artefacto exportado con el total por dimensión (tenant, severidad).
- **Estado:** merged a main en `795d433` (PR #81, 2026-09-04).

### 1.4 Backfill recompute job para `verdict_log` — ✅ shipped (PR #82)
- **Objetivo:** reprocesar veredictos antiguos cuando cambie la lógica de clasificación.
- **Cómo:** job que re-corre la clasificación sobre `verdict_log` histórico (la spec lo marca como **MAY**).
- **Por qué importa:** consistencia de auditoría retroactiva.
- **Criterio de hecho:** job ejecutable que actualiza veredictos sin romper la integridad.
- **Estado:** merged a main en `c63bb36` (PR #82, 2026-09-04).

---

## 🟡 P2 — Telemetría rica (el gap de datos que "de verdad falta")

> Según `docs/aiops-roadmap.md`: **el problema no es inteligencia, es datos.** Estos items aportan la materia prima de detección temprana.

### 2.1 Recolectar FEC errors (BIP-8) — ✅ shipped (chained: PR #84 + PR #85 + tracker #83, archive #86)
- **Objetivo:** capturar codewords FEC corregidos/no corregidos por ONT.
- **Por qué importa:** es **el mejor indicador temprano de fibra degradándose** (antes de que caiga RX).
- **Cómo:** extender la ingesta de métricas ópticas.
- **Dependencia crítica:** confirmar que SmartOLT/Mikrowisp exponen los contadores FEC. Si no, sale por SNMP/gNMI (ver 2.3).
- **Criterio de hecho:** el poller recolecta y persiste FEC por ONT; los detectores pueden operar sobre ello. ✅
- **Estado (PR 2 cerrado, 2026-09-04):** `runScheduledFecCollection()` en `apps/web/lib/monitoring/scheduler.ts` corre independiente del metrics poller (REQ-1) y del firmware audit; respeta el rate-budget SmartOLT (15 req/h) vía pre-flight guard; persiste los 4 kinds (`FEC_CORRECTED`, `FEC_UNCORRECTED`, `BIAS_CURRENT_MA`, `ONT_TEMPERATURE_CELSIUS`) por ONU; degrada a cero rows en Mikrowisp sin throw; **NO** dispara detectores (la detección corre downstream sobre los rows recién persistidos vía el job existente). 11 tests RED→GREEN en `apps/web/tests/lib/monitoring/fec-scheduler.test.ts`.

#### Variables de entorno (FEC collection loop)

| Variable | Default | Significado |
|---|---|---|
| `FEC_COLLECTION_ENABLED` | `false` | Kill switch + opt-in. `false` ⇒ no se registra `setInterval`. |
| `FEC_COLLECTION_INTERVAL_MS` | `3_600_000` (1 h) | Cadencia del tick. |
| `FEC_FAN_OUT_PER_CYCLE` | `8` | Tamaño de la slice de `pickFecFanOutSlice` por tick. |
| `FEC_RATE_LIMIT_PER_HOUR` | `15` | Techo de requests/hora al NMS. Si `sliceSize × (3 600 000 / intervalMs)` lo excede, el tick se skipea con un `console.warn` y `reason: 'rate_limit'`. |

**Kill switch:** setear `FEC_COLLECTION_ENABLED=false` y reiniciar el proceso evita nuevos ticks. Los ticks en vuelo corren hasta terminar (REQ-5). El disposer devuelto por `startFecCollectionLoop()` limpia el `setInterval` activo al deshacer el wiring de instrumentation.

### 2.2 Métricas ópticas completas por ONT — ✅ shipped (chained: PR #88 + PR #89, archive)
- **Objetivo:** cubrir RX/TX (ya hay) + **bias current, temperatura y LOS** por ONT.
- **Por qué importa:** diagnostica la salud física de la fibra y del transceptor antes de una falla.
- **Cómo:** extender `MetricKind` con `LOS_SECONDS_TOTAL` (Prisma migration), `OnuSummary.losSecondsTotal`, `pickNumber` con 6 candidate keys en SmartOLT, `assembleOnuDetailPoints` 1-line extension, `detectLosEvents` espejo de `detectFecDegradation`, `group.ts` + `SeriesByDevice.losSecondsTotal`, reconciliación de `TRAFFIC_THROUGHPUT_MBPS` en analytics+alerts.
- **Dependencia crítica:** P2.1 FEC scheduler (comparten endpoint del NMS y patrón de fan-out).
- **Criterio de hecho:** las métricas ópticas completas se recolectan y alimentan detectores + copiloto. ✅
- **Estado (PRs cerrados, 2026-09-04 / 2026-09-05):** delivery `stacked-to-main` con PR #88 (`feat(optical): add LOS_SECONDS_TOTAL MetricKind + losSecondsTotal wiring`, merge `2d9f3ca`, helpers-slice ~150 LOC) y PR #89 (`feat(detection): add detectLosEvents + alert wiring`, merge `ae92dc6`, detector-slice ~150 LOC); CI 14/14 verde en ambos. Persiste 5 optical kinds por ONU cada tick del FEC scheduler (8 × 5 = 40 rows, REQ-5 escenario `persisted:40`). Detector `detectLosEvents` 24h-window, `minSamples:3`, warning Δ≥1s, critical Δ≥30s (REQ-6); wired en `runDetectors` con `optical_degradation` AlertKind (REQ-7). Mikrowisp graceful-degrade: undefined ⇒ sin filas, sin errores, sin findings (REQ-3, REQ-4). Veredicto verify PASS con 9/9 requirements, 13/13 scenarios; archive `openspec/changes/archive/2026-09-05-p2-2-optical-metrics/`.

### 2.3 Colector SNMP traps — 🔵 PENDIENTE
- **Objetivo:** recibir traps SNMP de OLTs/ONTs (eventos que el polling HTTP no ve).
- **Por qué importa:** los traps capturan eventos push en tiempo real.
- **Escala:** si hay picos de traps que Node no absorbe → separar a collector (ver 3.1).
- **Criterio de hecho:** receptor SNMP ingesta traps y los normaliza a `telemetry.v1`.

### 2.4 Streaming gNMI/NETCONF (futuro) — 🔵 PENDIENTE
- **Objetivo:** telemetría push estructurada desde el NMS.
- **Por qué importa:** telemetría en streaming en lugar de polling.
- **Dependencia:** soporte del NMS; es el siguiente paso tras SNMP.
- **Criterio de hecho:** una fuente gNMI/NETCONF se integra al pipeline.

---

## 🟡 P2 — Integración de conectores

### 2.5 NetSense — 🔵 PENDIENTE (bloqueado: NMS real no disponible)
- **Objetivo:** implementar el adaptador NetSense.
- **Cómo:** el `provider` ya está en el schema (`SMARTOLT | MIKROWISP | NETSENSE`); falta el adaptador que hoy se rechaza explícitamente y **nunca** usa mocks.
- **Por qué importa:** cerrar el tercer NMS del modelo.
- **Criterio de hecho:** `/api/connectors/create` acepta `NETSENSE` y el copiloto consume datos reales de NetSense.
- **Dependencia:** un NMS NetSense real / especificación de su API.

---

## 🔵 P3 — Escala / NOC cognitivo (AIOps) — SOLO con gates numéricos

> **Regla de oro:** no se introduce un servicio nuevo "por si acaso". El roadmap define disparadores numéricos. **Realidad:** un ISP regional genera decenas a cientos de eventos/seg → PostgreSQL + TypeScript lo absorbe con holgura. El "millones" es escala carrier.

### 3.1 Collector de ingesta dedicado (Go)
- **Disparador:** > ~1.000 eventos/seg sostenidos, o picos de SNMP traps que Node no absorbe con headroom.
- **Cómo:** proceso separado que normaliza a `telemetry.v1`.
- **Criterio de hecho:** la ingesta cambia de etapa sin cambiar contrato de salida (modo sombra primero).

### 3.2 Correlación cross-device (Rust/Polars)
- **Disparador:** series temporales > ~50M filas y latencia de correlación > umbral.
- **Cómo:** correlacionar hallazgos entre dispositivos (un OLT que explica la caída de muchos clientes).
- **Criterio de hecho:** emite `finding.v1` solo confirmados, con latencia dentro del umbral.

### 3.3 Orquestación cognitiva Python (opcional)
- **Disparador:** necesidad real del ecosistema Python (no "porque es el estándar").
- **Cómo:** detrás del mismo contrato de la capa cognitiva actual (TS/`agent-core`).
- **Criterio de hecho:** el rol cognitivo mantiene `action.v1` igual que hoy.

### 3.4 Bus de eventos (Redis/NATS)
- **Disparador:** más de un servicio consumiendo los mismos eventos.
- **Cómo:** sustituir el acoplamiento directo por un bus + schemas (`telemetry.v1`, `finding.v1`, `action.v1`).
- **Criterio de hecho:** dos o más servicios consumen de los mismos topics sin romper contrato.

---

## Resumen ejecutivo del roadmap

| Prioridad | Item | Esfuerzo | Tipo | Estado |
|-----------|------|----------|------|--------|
| 🟠 P1.1 | Precision real (corpus etiquetado) | humano | evaluación | 🔵 pendiente (NOC) |
| 🟠 P1.2 | Cablear `detectTrafficAnomaly` | Bajo | SOC | ✅ shipped (#80) |
| 🟠 P1.3 | Export `injection_suspicion_total` | Bajo | observabilidad | ✅ shipped (#81) |
| 🟠 P1.4 | Backfill `verdict_log` | Medio | auditoría | ✅ shipped (#82) |
| 🟡 P2.1 | FEC errors (BIP-8) | Medio | telemetría | ✅ shipped (#83/#86) |
| 🟡 P2.2 | Ópticas completas por ONT | Medio | telemetría | ✅ shipped (#88/#89) |
| 🟡 P2.3 | Colector SNMP traps | Medio–Alto | ingesta | 🔵 pendiente |
| 🟡 P2.4 | Streaming gNMI/NETCONF | Alto (futuro) | ingesta | 🔵 pendiente |
| 🟡 P2.5 | NetSense | Medio | conector | 🔵 bloqueado (NMS) |
| 🔵 P3.x | Collector Go / Polars / Python / Bus | — | gated | 🔵 SOLO con gates |

---

## Recomendación de arranque (próxima sesión)

1. **P1.1 — Precision real (corpus etiquetado)** — arrancar en paralelo, depende del tech lead NOC etiquetando `docs/validation/labels.csv`.
2. **P2.3 — Colector SNMP traps** — siguiente paso de ingesta cuando tengamos telemetría óptica completa consolidada.
3. **P2.5 — NetSense** — solo cuando haya NMS real disponible.

---

*Roadmap de integraciones pendientes · FTTH-Copilot · 2026-09-04 (actualizado tras P1.2–1.4 y P2.1 shipped) · Ubicación en repo: `docs/roadmap-integraciones-pendientes.md` (copia local de trabajo: `/home/tecnodespegue/Documentos/roadmap-integraciones-ftth-copilot.md`)*
