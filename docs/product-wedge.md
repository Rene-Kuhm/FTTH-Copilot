# Product Wedge — FTTH-Copilot v0.1.0

> **Wedge definition for R1.** This document names exactly which fault types, which
> operator questions, and which evidence paths make up the first product story.
> Everything else is out of scope until this wedge is validated.

---

## What is the wedge?

**The first product story is offline-ONU and optical-fault diagnosis for
SmartOLT and Mikrowisp.**

It answers one question a NOC operator has every day at 2 AM:

> "Which ONUs went offline in the last 24 hours, why, and what do I do next?"

A secondary question is:

> "Which ONUs are about to go offline based on signal degradation?"

Everything else — SOC perimeter security, AIOps predictive analytics, SNMP
multi-vendor telemetry, multi-tenant alerting, firmware audit — is **not
included in the first product story**. It stays in the roadmap and in the
repository, but it is not the opening message.

---

## Wedge scope

### Fault types covered

| Fault type | Detection module | Severity |
|---|---|---|
| **ONU offline** — fiber cut, cable cut, ONT power loss | `detectLosEvents` (LOS counter rising) + SmartOLT `status=offline` | critical |
| **Multiple ONUs offline in same OLT / time window** | LOS correlation + topology BFS | critical |
| **Optical signal degradation** — borderline RX power | SmartOLT `signalStrength` below –26 dBm | warning |
| **Signal drift predicting fiber cut** | `detectSignalDrift` (trend → –27 dBm threshold) | warning |
| **ONT overheating** | `detectOpticalDegradation` (ONT temp > 70 °C) | critical |
| **OLT overheating** | `detectTemperatureDrift` (OLT temp trending toward 60 °C shutdown) | warning |

### What this wedge does NOT cover

- SOC perimeter security (syslog intrusion detection)
- Firmware vulnerability audit
- Traffic anomaly detection
- SNMP trap normalization for non-OLT devices
- Multi-vendor OLT telemetry beyond SmartOLT and Mikrowisp
- Automated remediation or one-click fixes
- Non-FTTH network segments (wireless, copper, data center)

---

## Operator question mapping

| Operator question | Adaptive router mode | Evidence source |
|---|---|---|
| "¿Cuáles ONUs están offline?" | `direct` (1 tool call) | SmartOLT `getAllOnus()` filtered by `status=offline` |
| "¿Por qué se fueron offline?" | `direct` → `assisted` (LLM explains) | ONU detail + LOS history + signal history |
| "¿Hay un patrón de corte?" | `assisted` | Correlation by OLT + time window |
| "¿Esta ONU va a caer?" | `investigation` | Signal drift prediction + FEC + temperature |
| "¿Qué hago ahora?" | `assisted` | Structured next-step from TruthGate-verified evidence |

---

## Evidence sources used in the wedge

1. **SmartOLT API** (`packages/connectors/connectors-smartolt`)
   - `getAllOnus()` → `status`, `signalStrength`, `ontTemperature`
   - `getOnuDetail(id)` → `losSecondsTotal`, `signalHistory`, `uptimeSeconds`
   - `getAllOlts()` → `temperatureCelsius`, `status`, `uptimeSeconds`

2. **Mikrowisp API** (`packages/connectors/connectors-mikrowisp`)
   - Same interface surface (mirror of SmartOLT)

3. **Detection module** (`packages/detection`)
   - `detectLosEvents` — LOS counter delta over 24 h window
   - `detectSignalDrift` — RX power trend with –27 dBm threshold crossing prediction
   - `detectOpticalDegradation` — ONT temperature and laser bias
   - `detectTemperatureDrift` — OLT temperature trend toward 60 °C

4. **TruthGate** (`packages/evidence`)
   - Every claim is verified against raw connector output before reaching the operator
   - Unverifiable statements → abstention with next-step

---

## Validation scenarios in fixtures

`packages/connectors/smartolt/src/fixtures.ts` contains embedded scenarios that
exercise every fault type in the wedge:

| Scenario | Fault type | Where |
|---|---|---|
| OLT-Este: 2 ONUs offline same window | Fiber cut / planta externa | `FIXTURE_ONUS` |
| OLT-Oeste: 2 ONUs offline high-temp OLT | OLT thermal failure | `FIXTURE_OLTS` |
| 1 ONU borderline signal (–26.5 dBm) | Signal degradation | `FIXTURE_ONUS` |
| 1 ONU with 10-day uptime | Stable baseline | `FIXTURE_ONUS` |
| Pre-failure signal history | LOS counter rising before offline | `FIXTURE_ONU_DETAILS` |

---

## Product promise (v0.1.0)

> FTTH-Copilot tells a NOC operator which ONUs are offline or degrading, shows
> why, and gives a next step — verified against raw SmartOLT/Mikrowisp data, not
> a guess.

---

## Out of scope for v0.1.0

- Real-time SNMP trap ingestion (UDP 1162)
- SOC syslog receiver (UDP 5514)
- Firmware vulnerability audit
- Predictive thermal or traffic analytics
- Automated ticket creation or webhook remediation
- Multi-vendor SNMP OLT telemetry (Huawei/ZTE/Nokia adapters)
- MikroTik or BDCOM connector integration
- Production deployment outside Docker Compose

---

## Status

- **v0.1.0 target**: offline-ONU + optical-fault diagnosis demo-ready
- **v0.2.0 candidate**: add SNMP trap ingestion and multi-OLT correlation
- **v0.3.0 candidate**: AIOps predictive drift and firmware audit
