# Benchmarks — FTTH-Copilot v0.1.0

> **Alcance de R6.** Este documento registra las métricas medibles con datos sintéticos y
> tests automatizados disponibles hoy. Las métricas que requieren piloto en campo con técnicos
> NOC reales están marcadas como `TBD — requiere piloto`. Consultá la sección de limitaciones.

---

## 1. Latencia de diagnóstico (Organic Diagnostic Router)

### 1a. Modo DIRECT — 0 llamadas LLM

| Métrica | Valor | Condición | Evidencia |
|---|---|---|---|
| Tool call única | **3 ms** | Fixture SmartOLT mock | [`direct-fixed.json`](https://github.com/Rene-Kuhm/tecnodespegue-landing/tree/main/demo-evidence) |
| Sin overhead LLM | Sí | `llmCalls: 0` | `execution.llmCalls: 0` en captura |
| TruthGate verdict | `ok` | Fresh + complete | `code: ok, reason: fresh-complete` |

**Caso capturado:** `estado de OLT-Norte-01`
- Tool: `get_olt_detail(oltId: "OLT-NORTE-01")`
- Respuesta: OLT online, 42 °C, 11 ONUs conectadas
- Latencia end-to-end de tool call: **3 ms**

### 1b. Modo INVESTIGATION — investigación con abstención

| Métrica | Valor | Condición | Evidencia |
|---|---|---|---|
| Tool calls | **4** | Correlación multi-fuente | [`investigation.json`](https://github.com/Rene-Kuhm/tecnodespegue-landing/tree/main/demo-evidence) |
| LLM calls | **4** | Driver determinístico de test | `llmCalls: 4` |
| Verdicts TruthGate | 2 × `ok`, 1 × `incomplete` | Partial completeness en `get_onus_with_low_signal` | `code: incomplete, reason: partial-completeness` |
| Abstención | **Sí** | El sistema se niega antes de inventar causa raíz | `abstained: true, nextStep: verificá el identificador` |

**Caso capturado:** `¿Cuál es la causa raíz de la caída de RX en OLT-Este-01?`

### 1c. Intention Classifier — accuracy sobre corpus

| Métrica | Valor | Umbral | Evidencia |
|---|---|---|---|
| Accuracy de clasificación | **≥ 0.95** | ≥ 0.95 requerido | `INTENTION_ACCURACY_THRESHOLD` en `packages/eval/src/intention-runner.ts` |
| False routings | **0** | Debe ser 0 | `INTENTION_FALSE_ROUTING_THRESHOLD = 0` |
| Superficies cubiertas | **7 / 7** | Todas | `surface: user-message, conversation-history, tool-args, connector-payload, retrieval-block, system-assembly, prediction-provider` |
| Casos en corpus | **≥ 30** | — | `packages/eval/corpus/intentions.json` |

Tests: `pnpm test --filter @ftth-copilot/eval` — 253 tests passing.

---

## 2. Precisión de detección de alertas

### 2a. Algoritmos de detección (synthetic test data)

| Detector | Fault type | Test | Resultado |
|---|---|---|---|
| `detectLosEvents` | ONU offline (LOS counter rising) | `packages/detection/tests/los.test.ts` | ✅ Passing |
| `detectSignalDrift` | Caída de RX predicha | `packages/detection/tests/signal-drift.test.ts` | ✅ Passing |
| `detectTemperatureDrift` | OLT con temperatura en ascenso | `packages/detection/tests/temperature-drift.test.ts` | ✅ Passing |
| `detectOpticalDegradation` | ONT con temperatura o bias fuera de rango | `packages/detection/tests/optical.test.ts` | ✅ Passing |
| `detectRebootStorm` | ONUs con reinicios frecuentes | `packages/detection/tests/reboots.test.ts` | ✅ Passing |
| `detectBaselineAnomaly` | Desviación respecto a baseline | `packages/detection/tests/anomaly.test.ts` | ✅ Passing |

### 2b. False positive rate de alertas (pilot threshold)

El módulo `computePilotMetrics` (`packages/eval/src/pilot-metrics.ts`) computa:

| Métrica | Umbral v0.1.0 | Fórmula |
|---|---|---|
| Alert false positive rate | **< 5%** | `fpAlerts / totalAlerts` |

El test `packages/eval/tests/pilot-acceptance.test.ts` valida:
```typescript
alertFalsePositiveRate: 0.02  // 2% < 5% ✓
```

### 2c. Precisión de afirmación de evidencia (TruthGate)

| Métrica | Valor | Evidencia |
|---|---|---|
| Supported claims ratio objetivo | **≥ 90%** | `supportedClaimsRatio ≥ 0.90` en `pilot-acceptance.test.ts` |
| Abstention rate | **TBD** | Requiere piloto con corpus NOC real |
| Precision (factual claims) | **TBD** | Requiere `labels.csv` del técnico NOC (Fase F decisión #6) |

---

## 3. Latencia del receptor SNMP

> **Gateway 7 — Benchmark publicado en [`docs/conformance-benchmark.md`](conformance-benchmark.md)**

| Métrica | Valor | Umbral SLA | Estado |
|---|---|---|---|
| **Latencia p95 (UDP loopback)** | **1.328 ms** | < 50 ms | ✅ PASS |
| Latencia promedio | 0.506 ms | < 25 ms | ✅ PASS |
| Latencia p50 | 0.377 ms | < 25 ms | ✅ PASS |
| Latencia p99 | 3.447 ms | < 100 ms | ✅ PASS |
| Throughput sostenido | 845 events/sec | > 100 events/sec | ✅ PASS |
| Drops bajo carga sostenida | **0** | 0 requerido | ✅ PASS |
| Delta de heap (300 traps) | 1.26 MB | < 50 MB | ✅ PASS |

Normalización in-memory por vendor (promedio < 0.1 ms por trap):
Huawei, ZTE, Nokia, FiberHome, Calix, Adtran, VSOL, BDCOM — todos ✅

Para ejecutar: `pnpm benchmark:snmp`

---

## 4. Tiempo de confirmación de causa y resolución

El módulo `computePilotMetrics` computa estas métricas sobre registros de investigación:

| Métrica | Test con datos mock | Fórmula |
|---|---|---|
| Tiempo hasta causa confirmada (mean) | **5 min** (mock) | `causeConfirmedAt - detectedAt` |
| Tiempo hasta causa confirmada (p95) | **10 min** (mock) | `calculateP95(causeDurations)` |
| Tiempo hasta resolución (mean) | **20 min** (mock) | `resolvedAt - detectedAt` |
| Tiempo hasta resolución (p95) | **30 min** (mock) | `calculateP95(resolutionDurations)` |

**Estado real: TBD** — requiere:
- Piloto con técnicos NOC reales durante ≥ 14 días
- ≥ 50 casos adjudicados (confirmados o incorrectos)
- Baseline de tiempo de resolución sin FTTH-Copilot para comparación

### Pilot acceptance thresholds (v0.1.0 gates)

```
decision = accepted si:
  hard_safety_passed = true
  diagnostic_accuracy ≥ 0.80
  supported_claims_ratio ≥ 0.90
  alert_false_positive_rate < 0.05
  latency_p95_ms < 15000
  duration_days ≥ 14
  adjudicated_cases ≥ 50
```

---

## 5. Cobertura de detección

| Superficie | Estado | Evidencia |
|---|---|---|
| Offline ONU (LOS counter rising) | ✅ Implementado | `detectLosEvents` + `los.test.ts` |
| Degradación de señal (RX bajo umbral) | ✅ Implementado | `detectSignalDrift` + `signal-drift.test.ts` |
| Deriva térmica de OLT | ✅ Implementado | `detectTemperatureDrift` + `temperature-drift.test.ts` |
| Sobrecalentamiento ONT | ✅ Implementado | `detectOpticalDegradation` + `optical.test.ts` |
| Reinicios frecuentes (ONT) | ✅ Implementado | `detectRebootStorm` + `reboots.test.ts` |
| Degradación FEC | ✅ Implementado | `detectFecDegradation` + `fec.test.ts` |
| Flapping (señal intermitente) | ✅ Implementado | `detectFlapping` + `flapping.test.ts` |
| Anomalía de tráfico | ✅ Implementado | `detectTrafficAnomaly` + `traffic.test.ts` |

---

## 6. Costo por investigación

| Métrica | Valor (mock) | Condición |
|---|---|---|
| Costo por investigación | **~$0.012 USD** | Con DeepSeek (~$0.00125/1K prompt + $0.005/1K completion) |
| Costo con MiniMax | **~$0.015 USD** | Proveedor por defecto |
| LLM calls para DIRECT | **0** | Sin costo de inferencia |
| LLM calls para INVESTIGATION | **4** (determinístico) | Driver de test |

---

## 7. Esfuerzo del operador

**No medible sin piloto.** Métricas candidatas:

| Métrica | Definición | Método de medición |
|---|---|---|
| Tiempo hasta primera alerta revisada | `firstAlertReviewedAt - alertCreatedAt` | Logging en UI dashboard |
| Consultas resueltas sin escalar | `direct + assisted` / `total` | Métrica Prometheus `ftth_copilot_router_dispatches_total{mode}` |
| Tasa de abstención percibida | Casos donde el operador tuvo que buscar manualmente | Feedback del técnico NOC post-piloto |

---

## Resumen: métricas disponibles hoy

| Categoría | Métrica | Valor | Confianza |
|---|---|---|---|
| Latencia diagnóstico | DIRECT tool call | **3 ms** | Alta (captura real) |
| Latencia diagnóstico | INVESTIGATION 4 tool calls | **4 LLM calls** | Alta (captura real) |
| Latencia SNMP | p95 UDP loopback | **1.33 ms** | Alta (benchmark reproducible) |
| Throughput SNMP | events/sec | **845 /sec** | Alta (benchmark reproducible) |
| Intention accuracy | accuracy ≥ 0.95 | **≥ 0.95** | Alta (253 tests) |
| Alert FP rate | pilot gate | **< 5%** | Media (threshold test only) |
| Supported claims | pilot gate | **≥ 90%** | Media (threshold test only) |
| Cobertura de detección | 8 fault types | **8/8 implemented** | Alta (tests passing) |
| Diagnostic accuracy | real field | **TBD** | Requiere piloto |
| Operator effort reduction | vs baseline | **TBD** | Requiere piloto |
| Lead time improvement | vs baseline | **TBD** | Requiere piloto |

---

## Limitaciones

- Las métricas marcadas **TBD** requieren un piloto autorizado con técnicos NOC reales durante ≥ 14 días y ≥ 50 casos adjudicados.
- Precision de afirmación factual (`computePrecision`) requiere que un técnico NOC marque `labels.csv` — decisión pendiente (Fase F #6).
- Costos de LLM son aproximados y varían según provider y modelo.
- El benchmark SNMP corre sobre UDP loopback (127.0.0.1); métricas de red real (WAN, firewalls, NAT) pueden diferir.

---

## Comandos para reproducir

```bash
# Tests de detección
pnpm test --filter @ftth-copilot/detection

# Benchmark SNMP (latencia, throughput, memoria)
pnpm benchmark:snmp

# Tests de evaluación (intention classifier, metrics, pilot)
pnpm test --filter @ftth-copilot/eval

# Tests de conformance (golden snapshots, fault scenarios, ASN.1)
pnpm test --filter @ftth-copilot/monitoring

# Tests del agente
pnpm test --filter @ftth-copilot/agent-core
```
