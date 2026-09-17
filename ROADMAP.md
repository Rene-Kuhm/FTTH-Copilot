# FTTH-Copilot Public Roadmap

FTTH-Copilot is evolving from an evidence-first FTTH operations platform into a field-validated NOC/SOC product. This roadmap separates capabilities already present in the repository from work that still requires operational validation or a deliberate product decision.

> This document communicates direction, not delivery dates or contractual commitments. Priorities can change when field evidence, security findings, or operator feedback justify it.

## How to read this roadmap

| Stage | Meaning |
|---|---|
| **Current** | Implemented in the repository and covered by the documented verification path. |
| **Validation** | Implemented foundations exist, but production claims require authorized field evidence. |
| **Next** | Candidate work that closes a known operational gap. |
| **Later** | Scale or specialization work that starts only when measurable gates justify it. |

## Current

| Capability | Operational outcome | Evidence |
|---|---|---|
| Organic Diagnostic Router | Routes operator requests through `direct`, `assisted`, or `investigation` mode so simple questions do not pay the cost of a full investigation. | [`packages/agent-core`](packages/agent-core), [README](README.md#copiloto-conversacional-organic-diagnostic-router) |
| Evidence-first diagnostics | Preserves provenance and data quality, applies TruthGate validation, and supports structured abstention when evidence is insufficient. | [`docs/evidence-first-roadmap.md`](docs/evidence-first-roadmap.md) |
| Multi-tenant NOC/AIOps | Detects optical and thermal degradation, correlates incidents, and supports human validation without mixing tenant evidence. | [`docs/architecture.md`](docs/architecture.md) |
| SOC operations | Parses syslog, detects suspicious access patterns, and tracks firmware findings through auditable records. | [`docs/architecture.md`](docs/architecture.md#7-motor-soc-en-detalle) |
| Multi-vendor OLT telemetry | Normalizes SNMP v1/v2c/v3 events through audited definitions and active adapters, with unknown events retained as evidence rather than guessed. | [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md) |
| NMS and notification integrations | Connects SmartOLT, Mikrowisp, and MikroTik; delivers alerts through webhooks, Telegram, Slack, and WhatsApp. | [README integration status](README.md#conectores-canales-de-alerta-y-estado-de-integración) |
| Operational observability | Exposes Prometheus metrics and OpenInference/OpenTelemetry traces for routing, tools, retrieval, latency, tokens, and provider fallback. | [README observability](README.md#3-observabilidad-y-métricas) |

## Validation

These items are not product-complete until the repository has evidence from an authorized operational environment.

### Field-certify OLT profiles

- Validate active adapters against authorized physical equipment and known firmware combinations.
- Compare raw packets, normalized events, timestamps, and recovery pairs with laboratory fixtures.
- Promote support levels only after the corresponding evidence is reviewable.

Detailed criteria: [`docs/roadmap-olt-multivendor.md`](docs/roadmap-olt-multivendor.md).

### Run a bounded ISP pilot

- Select an authorized pilot tenant and retain the documented manual fallback.
- Measure diagnostic correctness, supported-claim rate, abstention, alert false positives, p95 latency, and investigation cost.
- Exercise rollback and record an explicit launch, correction, or stop decision.

Detailed criteria: [`docs/roadmap-investigacion-cognitiva.md`](docs/roadmap-investigacion-cognitiva.md).

### Calibrate operational thresholds

- Replace provisional optical and incident thresholds with tenant-specific measurements.
- Keep collector health separate from device health.
- Validate alert escalation and cooldown behavior under real traffic patterns.

## Next

### Expand evidence-backed integrations

- Integrate NetSense only when an authorized NMS environment and stable API contract are available.
- Evaluate gNMI or NETCONF for richer streaming telemetry without weakening the passive-observation model.
- Extend field certification across more OLT model and firmware combinations.

### Strengthen product readiness

- Complete the field pilot and publish a bounded validation report.
- Define release criteria, version semantics, and release notes before creating the first public release.
- Continue hardening deployment, backup, recovery, audit retention, and tenant isolation using observed production needs.

### Improve operator experience

- Refine investigation summaries using adjudicated operator feedback.
- Make missing evidence and collector degradation easier to distinguish at a glance.
- Reduce time from alert to a verifiable next diagnostic action.

## Later

The following changes are intentionally gated by measurements. They are not automatic rewrites of the current TypeScript architecture.

| Candidate | Start only when |
|---|---|
| Dedicated ingestion collector | Measured throughput, latency, or isolation limits show the current process is insufficient. |
| Cross-device analytical service | Incident volume and topology size justify a specialized columnar workload. |
| Separate cognitive orchestration service | Model experimentation or deployment isolation cannot be handled cleanly behind the current contracts. |
| Event bus such as NATS or Redis Streams | Durable fan-out, replay, or backpressure requirements exceed the existing runtime. |

Architecture gates and target contracts are described in [`docs/aiops-roadmap.md`](docs/aiops-roadmap.md).

## Product guardrails

Every roadmap item must preserve these constraints:

1. **Evidence before assertion.** Missing or contradictory evidence produces an explicit limitation, not an invented diagnosis.
2. **Tenant isolation by construction.** Every identity, query, event, and artifact remains scoped to its tenant and authorized connection.
3. **Human operational authority.** The platform supports investigation and prioritization; it does not silently change network infrastructure.
4. **Passive telemetry by default.** SNMP integrations ingest and interpret data without issuing `SET` operations to OLTs.
5. **Measured architecture evolution.** New languages, services, and queues require a demonstrated operational need.
6. **No unsupported compatibility claims.** Vendor support levels advance only with traceable sources and reproducible evidence.

## Detailed plans and delivery records

- [`docs/roadmap-investigacion-cognitiva.md`](docs/roadmap-investigacion-cognitiva.md) — cognitive investigation and pilot acceptance.
- [`docs/roadmap-olt-multivendor.md`](docs/roadmap-olt-multivendor.md) — vendor research, adapter maturity, and field certification.
- [`docs/roadmap-integraciones-pendientes.md`](docs/roadmap-integraciones-pendientes.md) — known integration gaps and scaling candidates.
- [`docs/evidence-first-roadmap.md`](docs/evidence-first-roadmap.md) — provenance, TruthGate, abstention, and evaluation.
- [`docs/engineering/TRACKER_P2_1_FEC.md`](docs/engineering/TRACKER_P2_1_FEC.md) — completed FEC collection and operational integration record.

## Proposing a roadmap change

Before opening a pull request, read [`CONTRIBUTING.md`](CONTRIBUTING.md) and obtain maintainer approval for the proposed scope. Roadmap proposals should name the operator problem, required evidence, acceptance criteria, security impact, and rollback path.
