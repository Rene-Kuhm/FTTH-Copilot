# Specification: Fase 6 — Adaptadores de Fabricante OLT: VSOL, C-Data, BDCOM y Ubiquiti

## Acceptance Criteria

### Requirement 1: VSOL V1600 GPON Hierarchy & Serial Normalization
- The `VsolOltAdapter` MUST support Guangzhou V-Solution PEN 37950 (`1.3.6.1.4.1.37950`).
- The adapter MUST extract slot, port, onuId, and serial from varbinds and instance OID suffixes.
- ONT alarms (`vsolGponOntLossOfSignal`, `vsolGponOntDyingGasp`) MUST be scoped to `deviceKind: 'ONU'` with `deviceId: serial`.
- PON port alarms (`vsolGponPortDown`, `vsolGponPortUp`) MUST be scoped to `deviceKind: 'OLT'` with OLT device ID.

### Requirement 2: BDCOM P3600 GPON Hierarchy & Serial Normalization
- The `BdcomOltAdapter` MUST support Shanghai Baud Data (BDCOM) PEN 3320 (`1.3.6.1.4.1.3320`).
- The adapter MUST normalize traps defined in `NMS-GPON-MIB`: `nmsGponOntDyingGasp`, `nmsGponOntLos`, `nmsGponOntOnline`, `nmsGponOntOffline`, `nmsGponPonDown`, `nmsGponPonUp`.
- The adapter MUST extract slot, port, onuId, and serial from varbinds and instance OID suffixes.
- ONT alarms MUST be scoped to `deviceKind: 'ONU'` with `deviceId: serial`.

### Requirement 3: Generic xPON Fallback Adapter (`generic_xpon`)
- The `GenericXponAdapter` MUST serve as a safe fallback when an enterprise trap originates from an unknown or white-label xPON OLT.
- The adapter MUST extract standard IF-MIB metrics (`ifIndex`, `ifDescr`, `ifName`) when present.
- The adapter MUST preserve raw notification attributes, varbinds, and canonical fingerprint without claiming false vendor compatibility.

### Requirement 4: Alarm and Clear Recovery Pairing
- `vsolGponOntOnline` and clear traps MUST normalize with `isClear: true` and `clearsCategory: 'los'` or `clearsCategory: 'onu_offline'`.
- `nmsGponOntOnline` and `nmsGponPonUp` MUST normalize with `isClear: true` and appropriate `clearsCategory`.

### Requirement 5: Documented Limitations & White-Label Architecture
- Ubiquiti UF-OLT MUST have documented architectural limitation: standard MIB-II / IF-MIB support over SNMP, with deep GPON ONU state management performed via UISP WebSocket API rather than native enterprise SNMP traps.
- C-Data FD1600 MUST have documented OEM white-label architecture under PEN 34592.

### Requirement 6: Support Level L2 Elevation for at least Two Vendors (Gate 6)
- At least two vendors (VSOL and BDCOM) MUST reach Support Level L2 (Simulated) with verified sources, test fixtures in `fixtures/`, and passing `pnpm check:sources` and `pnpm generate:matrix`.
