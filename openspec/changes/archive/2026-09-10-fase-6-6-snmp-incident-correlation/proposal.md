# Fase 6 PR #2 — SNMP Trap and Incident Correlation + Recovery Linking

## Why

Roadmap Fase 6 (6.6):
- 6.6: "Vincular traps y recuperación con incidentes existentes; considerar desorden, retransmisiones y cambios de reloj del equipo."

Traps ingested in 6.1-6.5 produce `TelemetryEvent`s (`source: 'snmp-trap'`). This change connects those events to existing operational incidents:
1. Alarms (`los`, `dying_gasp`, `link_down`) associate with open incidents for the same device, updating timestamps without breaking temporal monotonic invariants.
2. Clearing/recovery events (`link_up`) mark open incidents as recovered or candidate for resolution.
3. UDP out-of-order and retransmission protection: An older alarm datagram received after a newer recovery is identified and discarded rather than reopening the incident.

## What changes

1. `packages/monitoring/src/snmp/incident-linker.ts` (new):
   - `correlateTrapWithIncidents(args)`: pure determinism linking incoming normalized traps with open tenant incidents.
   - Handles clock skew tolerance and out-of-order UDP sequence comparison.
   - Distinguishes alarm events (`los`, `dying_gasp`, `link_down`) from recovery events (`link_up`).
2. Unit tests in `packages/monitoring/tests/snmp/incident-linker.test.ts`:
   - Incident matching by `(tenantId, deviceKind, deviceId)`.
   - Tenant isolation: never matches cross-tenant incidents.
   - Recovery detection for `link_up`.
   - Stale out-of-order alarm rejection.
3. Export from `packages/monitoring/src/index.ts`.
