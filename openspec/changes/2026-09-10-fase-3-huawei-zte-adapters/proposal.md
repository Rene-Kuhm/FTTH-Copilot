# Proposal: Fase 3 — Adaptadores de Fabricante OLT: Huawei y ZTE

## Context & Motivation
With Fase 0 (binary SNMP receiver), Fase 1 (research sources & MIB governance), and Fase 2 (standard baseline & `OltVendorAdapter` contract) fully completed and verified, Fase 3 implements specialized vendor adapters for the top global market-share OLT vendors: **Huawei** (MA5600, MA5800 series) and **ZTE** (ZXA10 C300, C600 series).

Generic standard traps (IF-MIB, SNMPv2-MIB) cover system restarts and Ethernet link changes, but lack optical domain semantics. FTTH operations require deterministic extraction of:
1. Physical PON hierarchy: `frame / slot / port / ONU-ID` (or `rack / shelf / slot / port / ONU-ID`).
2. ONU Serial Numbers (e.g. `HWTC...` / `ZTEG...`) from vendor MIB varbinds or hex-encoded octet strings.
3. Optical and power alarm classification: `onu_los`, `onu_dying_gasp`, `onu_offline`, and recovery pairs (`onu_online`, `onu_los_clear`).
4. Elevation to Support Level L2 (Simulated) with verified test suites and binary test datagrams.

## Proposed Changes

1. **Vendor MIB & Trap Catalog Audit (`catalog.ts`)**:
   - Audit and confirm existing Huawei and ZTE traps with source traceability (`huawei-ma5600-snmp-mib-001`, `huawei-ma5800-product-doc-001`, `zte-c320-monitoring-001`, `zte-c600-official-portal-001`).
   - Add recovery/clear notification definitions: `hwGponOntOnline`, `hwGponOntLosClear`, `zxGponOntOnline`, `zxGponOntLosClear`.
   - Add PON port failure and restoration traps: `hwGponPortDown`, `hwGponPortUp`, `zxGponPortDown`, `zxGponPortUp`.

2. **Huawei OLT Adapter (`packages/monitoring/src/snmp/adapter/huawei.ts`)**:
   - Implements `OltVendorAdapter` for PEN 2011 (`MA5600`, `MA5800` families).
   - Extracts frame/slot/port/ONU and serial number from varbinds and OID instance suffixes.
   - Sets `deviceKind: 'ONU'` with `deviceId: <ONT_SERIAL>` when an ONU is identified.
   - Normalizes alarm categories: `los`, `dying_gasp`, `onu_offline`, `onu_online`, `pon_down`, `pon_up`.

3. **ZTE OLT Adapter (`packages/monitoring/src/snmp/adapter/zte.ts`)**:
   - Implements `OltVendorAdapter` for PEN 3902 (`C300`, `C600` families).
   - Extracts rack/shelf/slot/port/ONU and serial number from varbinds and OID instance suffixes.
   - Normalizes alarm categories and clear indicators.

4. **Deterministic Registry Wiring (`adapter/registry.ts`)**:
   - Register `HuaweiOltAdapter` and `ZteOltAdapter` in `defaultAdapterRegistry`.
   - Ensure disambiguation checks prevent cross-talk when OLTs share mixed environments.

5. **Research Catalog Elevation to Level L2**:
   - Update `research/olt/huawei/sources.yaml` and `compatibility.yaml` elevating MA5600 and MA5800 to Level L2.
   - Update `research/olt/zte/sources.yaml` and `compatibility.yaml` elevating C300 and C600 to Level L2.
   - Provide binary fixtures in `research/olt/huawei/fixtures/` and `research/olt/zte/fixtures/`.

6. **End-to-End Test Suite & Gate 3 Verification**:
   - Unit tests covering extraction of slot/port/ONU, serial numbers, alarms, and clear pairs.
   - Real binary test cases in `test-snmp.ts` for Huawei and ZTE notifications.
