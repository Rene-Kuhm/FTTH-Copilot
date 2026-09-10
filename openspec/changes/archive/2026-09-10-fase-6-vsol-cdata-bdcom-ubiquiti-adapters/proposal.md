# Proposal: Fase 6 — Adaptadores de Fabricante OLT: VSOL, C-Data, BDCOM y Ubiquiti

## Context & Motivation
Following the completion of Global Core (Huawei, ZTE, Nokia, FiberHome) and Tier-1 Regional (Calix, Adtran, DZS, Zyxel) adapters, Roadmap Fase 6 targets smaller regional and alternative ISP vendors: **VSOL**, **C-Data**, **BDCOM**, and **Ubiquiti**.

These vendors present unique architectural characteristics:
1. **Tree Separation**: VSOL and BDCOM market both EPON and GPON pizza-box OLTs under similar model lines, but they use distinct enterprise MIB trees (e.g. BDCOM P3310 EPON vs P3600 GPON with `NMS-GPON-MIB`).
2. **OEM & White-Label Hardware**: C-Data is the OEM manufacturer for numerous regional white-label brands (e.g., Optictimes, PHYHOME), using Shenzhen C-Data PEN 34592 and Cortina/Realtek chipsets. Identification must rely strictly on Enterprise OID roots rather than commercial re-branding.
3. **UISP vs SNMP Boundary in Ubiquiti**: Ubiquiti UFiber OLT (UF-OLT, UF-OLT-4, UISP Fiber) exposes standard MIB-II / IF-MIB over SNMP, but deep GPON ONU states (loss of signal, dying gasp) are transmitted natively via UISP WebSocket RPC rather than proprietary SNMP enterprise traps. Documenting this verifiable boundary is critical to avoid false MIB claims.
4. **Generic xPON Profile (`generic_xpon`)**: To safely handle traps from uncataloged or white-label xPON OLTs without claiming false vendor compatibility, a `generic_xpon` fallback adapter normalizes standard IF-MIB metrics, preserves raw varbinds, and defaults to conservative OLT/ONU scopes.

## Proposed Changes
1. **Research Registry Updates**:
   - `research/olt/vsol/`: Add V1600 GPON trap definitions and fixtures (`v1600-traps.json`), elevate V1600 to Level L2 (Simulated).
   - `research/olt/bdcom/`: Add P3600 `NMS-GPON-MIB` trap definitions and fixtures (`p3600-traps.json`), elevate P3600 to Level L2 (Simulated).
   - `research/olt/cdata/`: Document FD1600 GPON architecture under PEN 34592 at Level L1.
   - `research/olt/ubiquiti/`: Document verifiable architectural limitation (EdgeOS SNMP is standard MIB-II/IF-MIB only; deep GPON ONU events are managed via UISP WebSocket API, not SNMP enterprise traps).
2. **Catalog Extensions (`packages/monitoring/src/snmp/catalog.ts`)**:
   - Add VSOL V1600 GPON trap definitions (`vsolGponOntDyingGasp`, `vsolGponOntLossOfSignal`, `vsolGponOntOnline`, `vsolGponOntOffline`, `vsolGponPortDown`, `vsolGponPortUp`).
   - Add BDCOM P3600 GPON trap definitions (`nmsGponOntDyingGasp`, `nmsGponOntLos`, `nmsGponOntOnline`, `nmsGponOntOffline`, `nmsGponPonDown`, `nmsGponPonUp`).
3. **Vendor Hierarchy & Serial Extraction (`vendor-helpers.ts`)**:
   - Implement `extractVsolHierarchy` and `extractBdcomHierarchy`.
   - Update `decodeVendorSerialNumber` to recognize VSOL and BDCOM prefixes.
4. **Vendor Adapters**:
   - Implement `VsolOltAdapter` (`packages/monitoring/src/snmp/adapter/vsol.ts`) supporting PEN 37950.
   - Implement `BdcomOltAdapter` (`packages/monitoring/src/snmp/adapter/bdcom.ts`) supporting PEN 3320.
   - Implement `GenericXponAdapter` (`packages/monitoring/src/snmp/adapter/generic-xpon.ts`) providing a fallback profile for unknown xPON OLT traps.
   - Register in `defaultAdapterRegistry` and export from `@ftth-copilot/monitoring`.
5. **Testing & Gate 6 Verification**:
   - Unit tests for VSOL, BDCOM, and Generic xPON adapters.
   - Update `scripts/test-snmp.ts` with VSOL and BDCOM binary traps over UDP loopback.
   - Full monorepo validation (`pnpm turbo run lint typecheck test`).
