# Proposal: Fase 4 — Adaptadores de Fabricante OLT: Nokia y FiberHome

## Context & Motivation
With Fase 0 (binary SNMP receiver), Fase 1 (research sources & MIB governance), Fase 2 (standard baseline & `OltVendorAdapter` contract), and Fase 3 (Huawei & ZTE adapters) fully completed and verified, Fase 4 addresses the remaining two tier-1 vendors of the global optical access core: **Nokia** (7360 ISAM and Lightspan MF/FX series) and **FiberHome** (AN5516 and AN6000 series).

Nokia and FiberHome represent major market shares across Latin America, North America, and Europe:
- **Nokia / Alcatel-Lucent**: PENs 637 (Alcatel), 6527 (TiMOS/Service Router), and 28458. The 7360 ISAM uses ASAM MIBs (ASAM-ALARM-MIB, ASAM-EQUIP-MIB) with optical hierarchy indexes (rack/shelf/slot/port/ontIdx) and `ALCL` / `NOKT` serial prefixes. Lightspan MF/FX introduces next-gen modular architecture with card failure and port status notifications.
- **FiberHome**: PEN 3807. Uses FH-GPON-MIB and FIBERHOME-OLT-COMMON-MIB with `FHTT` serial numbers, slot/port/onuId indexing, and distinct alarm/recovery pairs (`fhGponOntLossOfSignal`, `fhGponOntDyingGasp`, `fhGponOntOffline`, `fhGponOntOnline`, `fhGponOntLosClear`, `fhGponPortDown`, `fhGponPortUp`).

Fase 4 delivers specialized adapters for both vendors, extracts physical PON hierarchy and ONU serial numbers, normalizes alarm and recovery pairs, provides realistic test fixtures, and elevates both vendors to Level L2 (Simulated) under Gate 4.

## Proposed Changes

1. **Vendor MIB & Trap Catalog Expansion (`catalog.ts`)**:
   - Audit and define Nokia 7360 ISAM and Lightspan trap definitions under PENs 637 and 6527 (`nokiaOntLossOfSignal`, `nokiaOntDyingGasp`, `nokiaOntOffline`, `nokiaOntOnline`, `nokiaOntLosClear`, `nokiaPonPortDown`, `nokiaPonPortUp`, `nokiaCardFailure`).
   - Audit and confirm FiberHome AN5516 and AN6000 trap definitions under PEN 3807 (`fhGponOntLossOfSignal`, `fhGponOntDyingGasp`, `fhGponOntOffline`, `fhGponOntOnline`, `fhGponOntLosClear`, `fhGponPortDown`, `fhGponPortUp`, `fhCardFailure`).
   - Ensure all catalog definitions have explicit source IDs, confidence grades, licensing, and clear pairing.

2. **Optical Hierarchy & Serial Decoding Helpers (`extractors/vendor-helpers.ts`)**:
   - Implement `extractNokiaHierarchy` supporting rack/shelf/slot/port/ontId and `ALCL`/`NOKT` serial numbers.
   - Implement `extractFiberhomeGponHierarchy` supporting slot/port/onuId (and subrack/slot/port/onuId) and `FHTT` serial numbers.

3. **Nokia OLT Adapter (`packages/monitoring/src/snmp/adapter/nokia.ts`)**:
   - Implements `OltVendorAdapter` for Nokia (PENs 637, 6527, 28458).
   - Supports 7360 ISAM and Lightspan MF/FX families.
   - Sets `deviceKind: 'ONU'` with `deviceId: serial` (or synthesized `${identity.oltId}:onu:rack/shelf/slot/port/ontId`).
   - Pairs recovery traps (`nokiaOntOnline` -> `onu_offline`, `nokiaOntLosClear` -> `los`, `nokiaPonPortUp` -> `pon_down`).

4. **FiberHome OLT Adapter (`packages/monitoring/src/snmp/adapter/fiberhome.ts`)**:
   - Implements `OltVendorAdapter` for FiberHome (PEN 3807).
   - Supports AN5516 and AN6000 families.
   - Sets `deviceKind: 'ONU'` with `deviceId: serial` (or synthesized `${identity.oltId}:onu:slot/port/onuId`).
   - Pairs recovery traps (`fhGponOntOnline` -> `onu_offline`, `fhGponOntLosClear` -> `los`, `fhGponPortUp` -> `pon_down`).

5. **Registry Wiring (`adapter/registry.ts`) & Module Exports**:
   - Register `NokiaOltAdapter` and `FiberhomeOltAdapter` in `defaultAdapterRegistry`.
   - Export both adapters from `packages/monitoring/src/index.ts`.

6. **Research Catalog Elevation to Level L2**:
   - Elevate Nokia (7360-ISAM-FX, Lightspan-MF) in `research/olt/nokia/compatibility.yaml` and `sources.yaml` to Level L2.
   - Elevate FiberHome (AN5516, AN6000) in `research/olt/fiberhome/compatibility.yaml` and `sources.yaml` to Level L2.
   - Provide binary test fixtures in `research/olt/nokia/fixtures/7360-isam-traps.json` and `research/olt/fiberhome/fixtures/an5516-traps.json`.

7. **Verification & Testing (Gate 4)**:
   - Dedicated unit test suites (`nokia-adapter.test.ts`, `fiberhome-adapter.test.ts`).
   - Integrated end-to-end loopback validation in `scripts/test-snmp.ts` including Nokia and FiberHome traps.
   - Full monorepo verification passing all CI quality gates.
