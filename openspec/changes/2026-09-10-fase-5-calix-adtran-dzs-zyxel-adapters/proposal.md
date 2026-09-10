# Proposal: Fase 5 — Adaptadores de Fabricante OLT: Calix, Adtran, DZS y Zyxel

## Context & Motivation
Following the successful completion and verification of Fase 0 through Fase 4, which established the binary SNMP engine, the MIB research and provenance framework, the baseline adapter contract, and Tier-1 core adapters (Huawei, ZTE, Nokia, FiberHome at Support Level L2), Fase 5 targets the tier of North American, European, and alternative enterprise OLT vendors:
1. **Calix**: Authoritative IANA PEN 6321 (and legacy alias 1264). Operates the E-Series (E7-2, E7-20 chassis using `E7-Calix-MIB` and `E7-Notifications-MIB`) and next-generation AXOS systems (E9-2 modular architecture). The roadmap requires strictly separating E7 from E9/AXOS and not assuming a common MIB.
2. **Adtran**: Authoritative IANA PEN 664. Deploys the Total Access 5000 (TA5000) chassis running AOS and `ADTRAN-GENGPON-MIB`, alongside next-gen SDX-6000 running Mosaic Cloud Platform. The roadmap requires separating TA5000 from SDX/Mosaic.
3. **DZS (DASAN Zhone Solutions)**: Authoritative IANA PENs 5504 (Zhone Technologies) and 6296 (DASAN Network Solutions). Separates legacy MXK from Velocity-V1.
4. **Zyxel**: Authoritative IANA PEN 890. Covers IES chassis OLTs (IES5206, IES4204).

Per Gate 5 of the Multi-Vendor OLT Roadmap (`docs/roadmap-olt-multivendor.md`):
- Every vendor must have an audited inventory of sources and at least Level L1.
- At least one vendor must reach Level L2 before proceeding.
This change elevates both **Calix (E7)** and **Adtran (TA5000)** to Support Level L2 (Simulated) with full optical hierarchy extraction, serial parsing (`CXNK`, `ADTN`), alarm/recovery pairing, and deterministic device scoping. DZS and Zyxel maintain clean Level L1 registries with corrected IANA PENs.

## Proposed Changes

1. **Authoritative IANA PEN Correction (`iana-pen.ts`)**:
   - Correct Calix primary PEN to 6321 while retaining 1264 as an alias.
   - Correct DZS primary PENs to 5504 (Zhone) and 6296 (DASAN) while retaining 5597 as a legacy alias.
   - Retain Adtran (664) and Zyxel (890).

2. **Research Catalog Updates & Gate 5 Level Elevation**:
   - Elevate Calix (`E7`) to Level L2 in `research/olt/calix/compatibility.yaml` and `sources.yaml`. Explicitly separate `E9` at Level L1. Add fixture `research/olt/calix/fixtures/e7-traps.json`.
   - Elevate Adtran (`TA5000`) to Level L2 in `research/olt/adtran/compatibility.yaml` and `sources.yaml`. Explicitly separate `SDX-6000` at Level L1. Add fixture `research/olt/adtran/fixtures/ta5000-traps.json`.
   - Update DZS and Zyxel registries with accurate IANA PENs and source definitions.
   - Validate with `pnpm check:sources` and `pnpm generate:matrix`.

3. **Vendor Trap Catalog Expansion (`catalog.ts`)**:
   - Calix E7: `e7TrapAlarm` (1.3.6.1.4.1.6321.1.2.2.4.2.1), `e7TrapEvent`, `e7TrapDbChange`, `e7TrapSecurity`, and `e7TrapAlarmClear` (clear pair).
   - Adtran TA5000: `adGenGponOntAlarmSlotLosLevel` (1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.1), `adGenGponOntOMCICommFailAlarmSet` (..25), `adGenGponOntDyingGaspAlarm` (..38), `adGenGponPonDown` (..5), `adGenGponPonUp` (..6, clear pair), `adGenGponOntOnline` (..26, clear pair), `adGenGponOntLosClear` (..2, clear pair).
   - Ensure all definitions carry valid source IDs, confidence grades, licensing, and clear pairing.

4. **Hierarchy & Serial Decoding Utilities (`extractors/vendor-helpers.ts`)**:
   - Support `CXNK` (Calix) and `ADTN` (Adtran) ONT serial numbers in `decodeVendorSerialNumber`.
   - Implement `extractCalixHierarchy` parsing `e7TrapCliObject` (e.g. `ont 1/1/1`), `e7TrapText` (e.g. `Loss of Signal`, `Dying Gasp`, `ONT Offline`, `PON Link Down`), and serials.
   - Implement `extractAdtranHierarchy` parsing `ifDescr` (e.g. `gpon 1/2/3`, `ont 1/2/3.4`), instance indexes, and serials.

5. **Calix OLT Adapter (`adapter/calix.ts`)**:
   - Implements `OltVendorAdapter` for Calix (PEN 6321, 1264).
   - Supports E7 family; safely abstains or falls back on E9/AXOS when AXOS-specific models or enterprise subtrees appear.
   - Normalizes ONT alarms (`deviceKind: 'ONU'`, serial) and OLT chassis/PON alarms (`deviceKind: 'OLT'`).
   - Pairs recovery traps (`e7TrapAlarmClear`, ONT online events).

6. **Adtran OLT Adapter (`adapter/adtran.ts`)**:
   - Implements `OltVendorAdapter` for Adtran (PEN 664).
   - Supports TA5000 family; safely separates SDX-6000 / Mosaic.
   - Normalizes ONT alarms (`deviceKind: 'ONU'`, serial) and OLT PON alarms (`deviceKind: 'OLT'`).
   - Pairs recovery traps (`adGenGponOntOnline`, `adGenGponOntLosClear`, `adGenGponPonUp`).

7. **Registry Wiring & Exports**:
   - Register `CalixOltAdapter` and `AdtranOltAdapter` in `defaultAdapterRegistry`.
   - Export new adapters from `packages/monitoring/src/index.ts`.

8. **Verification & Testing (Gate 5)**:
   - Dedicated unit test suites for Calix and Adtran adapters.
   - End-to-end loopback validation in `scripts/test-snmp.ts` including Calix and Adtran traps.
   - Monorepo validation passing all CI quality gates.
