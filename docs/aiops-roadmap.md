# Roadmap — FTTH-Copilot hacia un NOC Cognitivo (AIOps)

> **Qué es este documento:** el plan de evolución de FTTH-Copilot desde el NOC reactivo/proactivo actual hacia un NOC cognitivo con AIOps, en tres etapas de datos (ingesta → filtrado → orquestación).
>
> **Principio rector (leé esto primero):** el 99% de la telemetría se filtra barato; **solo el 1% (anomalías confirmadas) llega a la capa cognitiva**. Los lenguajes (Go, Rust/Polars, Python) son detalle de implementación; **los contratos entre etapas son el producto**.

## 1. Modelo mental

Un NOC tradicional es reactivo: te enterás del problema cuando el enlace cae. El NOC cognitivo invierte la lógica:

```text
telemetría ──► FILTRO (99% descartado) ──► 1% anomalías ──► AGENTE (root-cause + acción)
```

Tres invariantes que atraviesan todo el plan:

1. **Regla del 1%** — el LLM nunca ve eventos crudos; solo *findings* confirmados.
2. **Contratos como frontera** — cada etapa habla JSON versionado (`*.v1`); cualquier etapa se puede reemplazar de lenguaje sin tocar las otras.
3. **Pre-alerta, no alarma** — la señal es "esto se va a degradar en 72h", no "esto se cayó".

**Dato clave honesto:** la parte cognitiva difícil ya existe en el repo, en TypeScript. `detectSignalDrift` + `predictThresholdCrossing` ya producen *"RX derivando hacia −27 dBm con ETA"*. Lo que falta no es inteligencia, es **telemetría más rica** (FEC errors, SNMP traps) y, cuando el volumen lo justifique, **aislar etapas en servicios especializados**.

## 2. Estado actual vs. objetivo

| Etapa | Hoy (todo TypeScript) | Objetivo |
|-------|----------------------|----------|
| **Ingesta** | Polling HTTP (SmartOLT/Mikrowisp) + receptor syslog UDP en Node | + SNMP traps, + streaming (gNMI/NETCONF); collector especializado si el volumen lo pide |
| **Filtrado/Correlación** | Detectores TS puros por dispositivo (deriva, flapping, reboots, mediana+MAD) | + FEC/óptica por ONT, + correlación cross-device; Polars solo a escala |
| **Cognitiva** | `agent-core` en TS (tool `get_predicted_issues`) | Mismo rol; Python opcional, detrás del mismo contrato |

**Gaps de datos (lo que de verdad falta):**

- **FEC errors** (BIP-8: codewords corregidos / no corregidos) — el mejor indicador temprano de fibra degradándose, hoy **no se recolecta**.
- **SNMP traps** — hoy no hay collector SNMP.
- **Métricas ópticas por ONT** (RX/TX power, bias current, temperatura, LOS) — parcial (RX/TX sí, el resto no).

## 3. Arquitectura objetivo

```text
┌────────────────────────────────────────────────────────────────────────┐
│ ETAPA 1 — INGESTA (collectors)                                          │
│   HTTP polling (hoy) · Syslog (hoy) · SNMP traps (nuevo) · gNMI (futuro)│
│   ──► normaliza a telemetry.v1 ──► topic: telemetry.normalized          │
└────────────────────────────────────────────────────────────────────────┘
                                    │
┌────────────────────────────────────────────────────────────────────────┐
│ ETAPA 2 — FILTRO / CORRELACIÓN (detectors)                              │
│   series temporales, línea base (MAD), FEC, correlación cross-device    │
│   ──► emite finding.v1 (solo confirmados) ──► topic: findings.confirmed │
└────────────────────────────────────────────────────────────────────────┘
                                    │
┌────────────────────────────────────────────────────────────────────────┐
│ ETAPA 3 — ORQUESTACIÓN COGNITIVA (agente + LLM)                         │
│   consume el 1%, genera root-cause, pre-alerta accionable y workflows   │
│   ──► emite action.v1 ──► incidentes + notificaciones + automatización  │
└────────────────────────────────────────────────────────────────────────┘
```

Cada etapa es un **proceso separado con un contrato de entrada/salida**. Lo que las conecta es el bus + los schemas, no el lenguaje.

## 4. Contratos (la parte que de verdad importa)

Estos JSON son la frontera estable. Si los fijamos bien, mover una etapa de TS → Go → Rust → Python es un swap, no una reescritura.

### `telemetry.v1` — evento normalizado (salida de ingesta)

```json
{
  "schema": "ftth.telemetry.v1",
  "tenantId": "c_...",
  "deviceKind": "ONU",
  "deviceId": "onu-0001",
  "source": "poll | syslog | snmp-trap | gnmi",
  "ts": "2026-08-30T12:00:00.000Z",
  "metrics": {
    "rx_power_dbm": -24.1,
    "tx_power_dbm": 2.1,
    "fec_corrected": 12,
    "fec_uncorrected": 0
  },
  "tags": { "oltId": "olt-001", "customer": "..." }
}
```

### `finding.v1` — anomalía confirmada (salida de filtrado → entrada cognitiva)

```json
{
  "schema": "ftth.finding.v1",
  "kind": "signal_drift | fec_degradation | temperature_drift | flapping | reboot_storm | traffic_anomaly",
  "severity": "warning | critical",
  "deviceKind": "ONU",
  "deviceId": "onu-0001",
  "confidence": 0.92,
  "etaMs": 259200000,
  "evidence": { "slopeDbmPerDay": -0.5, "windowMs": 259200000 },
  "context": { "tenantId": "c_...", "oltId": "olt-001", "customer": "..." }
}
```

### `action.v1` — salida de la capa cognitiva

```json
{
  "schema": "ftth.action.v1",
  "type": "pre_alert | ticket | workflow | notify",
  "incidentId": "...",
  "title": "FEC en aumento en onu-0001",
  "body": "FEC no corregido creciendo 72h; revisar conector antes de corte.",
  "targets": { "webhook": true, "telegram": true, "ticketing": false }
}
```

## 5. Transporte

- **Hoy:** PostgreSQL + HTTP (el poller escribe `metric_samples`, el agente lee `detected_alerts`). Suficiente a la escala actual.
- **Objetivo:** un stream liviano cuando separemos servicios. Recomendación: **Redis Streams** o **NATS JetStream** (un solo binario, decenas de MB, sin clusters gigantes). Kafka queda descartado a esta escala — contradice tu propia premisa de "servidor estándar".

**Gate de decisión:** no introduzcas el bus hasta que haya **más de un servicio** que necesite consumir los mismos eventos. Hoy todo está en un proceso; el bus sería deuda especulativa.

## 6. Plan de migración por fases

Cada fase es **testeable, con CI verde y reversible** de forma independiente. Ninguna fase introduce un servicio nuevo "por si acaso".

### Fase 0 — Cimientos de contrato (sin servicios nuevos)
- Documentar y congelar `telemetry.v1` / `finding.v1` / `action.v1`.
- Mapear el flujo interno actual a esos contratos (aunque sigan viviendo en el monorepo).
- Agregar **FEC errors + óptica por ONT** al modelo `MetricSample` (nuevos `MetricKind`: `FEC_CORRECTED`, `FEC_UNCORRECTED`).

### Fase 1 — Detectores de degradación microscópica (TS, sin cambiar de lenguaje)
- Nuevos detectores puros en `@ftth-copilot/detection`:
  - `detectFecDegradation` — FEC corregido/no corregido creciendo sobre línea base → pre-alerta **antes** de que RX cruce −27 dBm.
  - `detectOpticalDegradation` — bias current / temperatura ONT fuera de rango.
- Alertas persistentes + incidentes + notificación (reutilizando el pipeline actual).
- **Este es el mayor retorno inmediato**: cierra el hueco de datos que hace creíble el "NOC cognitivo".

### Fase 2 — Extraer la ingesta a un collector Go (cuando el volumen lo pida)
- Disparador: SNMP traps o streaming sostenido que Node ya no absorba con headroom.
- Un collector Go que recibe syslog + SNMP traps, normaliza a `telemetry.v1` y publica al stream.
- El resto del sistema sigue igual; solo cambia la fuente de ingesta.

### Fase 3 — Correlación cross-device (Rust/Polars, solo a escala)
- Disparador: millones de filas y correlación que desborde PostgreSQL+TS.
- Consume `telemetry.normalized`, emite `finding.v1`. Mismo contrato que los detectores TS.

### Fase 4 — Aislar la orquestación cognitiva (Python, opcional)
- Disparador: querés el ecosistema Python (LangChain, ML) para el agente.
- Consume `finding.v1`, emite `action.v1`. El agente TS actual puede seguir conviviendo: **dos consumidores del mismo contrato**.

## 7. Decision gates (números, no intuición)

| Cambio | Disparador concreto |
|--------|---------------------|
| Collector Go | > ~1.000 eventos/seg sostenidos, o SNMP traps con picos que Node no absorbe con headroom |
| Rust/Polars | series temporales > ~50M filas y correlación cross-device con latencia > umbral |
| Python cognitivo | necesidad real del ecosistema Python, no "porque es el estándar" |
| Bus (Redis/NATS) | más de un servicio consumiendo los mismos eventos |

**Realidad de escala:** un ISP FTTH regional (cientos de OLTs × miles de ONTs, poll cada 5–15 min) genera **decenas a cientos de eventos/seg**, no millones. PostgreSQL + TypeScript absorbe eso con holgura. El "millones de JSONs" es escala carrier, no regional.

## 8. Calidad y testing (cómo se mantiene el estándar)

- **Contratos = tests de contrato.** Golden files de `telemetry.v1` / `finding.v1` / `action.v1` para que ningún cambio de etapa rompa el schema sin querer.
- **Detectores puros** (igual que hoy): series sintéticas, umbrales y bordes cubiertos; cobertura 100% statements en cada detector nuevo.
- **Cada servicio nuevo lleva su propio CI** (lint + typecheck + tests + coverage) antes de merge.
- **Regla de oro:** una etapa nueva se integra **detrás** del contrato existente con datos reales primero (modo sombra), y recién después reemplaza a la anterior.

## 9. Decisiones honestas y riesgos

1. **El polyglot prematuro es el riesgo #1.** Tres servicios nuevos = tres despliegues, tres pipelines, observabilidad y on-call. No se justifica a la escala actual.
2. **FEC depende del NMS/OMCI.** Hay que confirmar que SmartOLT/Mikrowisp exponen los contadores FEC; si no, la telemetría sale del OLT vía SNMP/gNMI (otro motivo para el collector Go en Fase 2).
3. **El valor está en los datos, no en el lenguaje.** La Fase 1 (FEC + detectores) entrega el "NOC cognitivo" real mucho antes que cualquier cambio de stack.
