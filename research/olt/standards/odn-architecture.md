# ODN (Optical Distribution Network) Architecture

> **Roadmap Fase ODN** — Physical plant model
> **Status:** Documented; component detection implemented (see `packages/monitoring/src/snmp/adapter/odn-hints.ts`)

## TL;DR

The **ODN** is the passive fiber plant between OLT and subscriber. FTTH-Copilot now
models its components explicitly:

```
OLT → feeder fiber → FDH (Fiber Distribution Hub)
                          │
                          ├─ primary splitter (1:8 or 1:16)
                          │
                          ▼
                      splitter (1:8 or 1:16)
                          │
                          ▼
                       NAP (Network Access Point)
                          │
                          ▼
                       FAT / CTO (Fiber Access Terminal / Caja Terminal Óptica)
                          │
                          ▼
                      drop cable
                          │
                          ▼
                       ONT
```

## Components we model

| Component | `OdnComponentKind` | Detection source |
|-----------|---------------------|------------------|
| OLT | `OLT` | Always known |
| FDH (Fiber Distribution Hub) | `FDH` | SNMP varbind hint, low confidence |
| Splitter | `SPLITTER` | SNMP varbind or operator registry |
| NAP | `NAP` | Mikrowisp ODB type, varbind hint |
| FAT | `FAT` | Varbind hint (Huawei-style outdoor closure) |
| CTO | `CTO` | Varbind hint, topology-correlation |
| Drop cable | `DROP_CABLE` | Operator registry only |
| ONU | `ONU` | Always known |

## Detection principles

Per the evidence-first principle, **FTTH-Copilot never invents ODN components**:

1. **Operator registry** is the primary source of truth (`TopologyLevel` /
   `OdnTopologyGraph` from connector provider).
2. **SNMP hints** (`extractOdnHints`) extract candidate component IDs only when
   a varbind value matches a recognizable pattern (`CTO-NORTE-12`, `ODB-CENTRO-01`,
   `SPL-1234`, `FAT-SUR-03`).
3. **Topology correlation** groups affected ONUs under common CTOs only when both
   share a registered edge.

## Existing integration

The system already uses CTO and Splitter in `packages/evidence/src/topology-correlation.ts`:

```typescript
const DEFAULT_ANCESTOR_KINDS: TopologyNodeKind[] = ['CTO', 'SPLITTER', 'PON_PORT', 'OLT'];
```

What this PR adds:
- Type-level entity: `OdnComponent`, `OdnTopologyGraph`, `OdnComponentHint`
- Detection: `extractOdnHints` reads SNMP varbinds
- Validation: hints are advisory (`confidence: 'low'|'medium'|'high'`) and do not
  enter the authoritative topology unless confirmed

## What this enables

1. **Smart hypothesis**: when multiple ONUs under `CTO-X` lose signal simultaneously,
   the system can suggest "distribution segment cut" instead of enumerating per-ONU faults.
2. **Failure scope narrowing**: a fault affecting a CTO affects 8-16 ONUs; a fault
   affecting a splitter affects 64-128 ONUs; a fault at the OLT affects thousands.
3. **Field-tech diagnostics**: techs can see exactly which physical segment is at risk
   without manually tracing fiber paths.

## Roadmap

| Phase | Work |
|-------|------|
| **Fase ODN (current)** | Type model + varbind hint extractor |
| **Fase ODN-2** | Mikrowisp `NAP-CENTRO-01` integration: convert Mikrowisp ODB rows to OdnComponent |
| **Fase ODN-3** | OTDR event trap definitions (Cisco / Huawei / Nokia) |
| **Fase ODN-4** | Splitter cascade detection (multi-stage cascade inference) |
