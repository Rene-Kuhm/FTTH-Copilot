# TR-451 vOLT & vOMCI — Disaggregated OLT Architecture

> **Roadmap Fase ODN** — Standards readiness tracking
> **Author:** FTTH-Copilot research registry
> **Status:** Documented, no vendor implementation yet

## TL;DR

Broadband Forum TR-451 defines a **virtualized OLT (vOLT)** architecture that decouples the
OLT hardware from its control / data-plane software. This enables multi-vendor interoperability
at the OLT level, similar to what vRAN (O-RAN) did for mobile base stations.

A second spec, **TR-451 vOMCI**, virtualizes the OMCI channel between OLT and ONT, allowing
operators to use ONT management software from any vendor with any vOLT.

## Why this matters for FTTH-Copilot

FTTH-Copilot currently identifies OLTs by their IANA PEN (e.g. Huawei = 2011, Nokia = 637).
A vOLT could expose the same MIB tree through a white-box hardware vendor (Edgecore,
Edgecore/Intel, TIP) with a vendor-neutral southbound interface.

**For our purposes, vOLT-ready means:**
- The OLT hardware supports any NOS via OCP / TIP / FD.io interfaces
- OMCI is exposed as a northbound API instead of embedded firmware
- We can still talk to it via standard SNMP/MIB without vendor-specific code

## Vendors with vOLT or disaggregated offerings

| Vendor | Product | Standards | Status |
|--------|---------|-----------|--------|
| **Edgecore** | ASXvOLT16, ASXvOLT64 | TR-413/TR-451 | Shipping (TIP-recognized) |
| **Nokia** | AnyPON + Altiplano (on FX platforms) | TR-451 vOMCI | Shipping |
| **Calix** | AXOS platform (E9-2, E7-2) | Vendor-proprietary but OMCI-standard | Shipping |
| **Adtran** | Mosaic OS (TA5000, SDX) | TR-069 / USP focus | Shipping |
| **Cisco** | NCS 1010 + IOS XR | TIP-compliant | Shipping |
| **Huawei** | MA5800 (still embedded NOS) | OMCI standard, no vOLT yet | Watch |
| **ZTE** | TITAN C600/C680 | OMCI standard, no vOLT yet | Watch |
| **DZS** | Velocity V6 (sdNOS) | Partial vOLT via sdNOS | Watch |

## How we model it

`OltDetail` exposes:

```typescript
interface StandardsCompliance {
  omciVersion?: string;       // e.g. "G.988 Amd 2"
  vOMCIReady?: boolean;        // TR-451 vOMCI northbound API
  tr069Supported?: boolean;    // Legacy CPE management
  tr369UspSupported?: boolean; // USP / TR-369 for CPE
  disaggregatedVlt?: boolean;  // TR-451 vOLT hardware interface
}
```

For Huawei MA5800-X17 we record:
- `omciVersion: "G.988"`
- `vOMCIReady: true` (Huawei announced ONF SEBA integration)
- `disaggregatedVlt: false` (still embedded NOS)

For Calix 844G-1 we record:
- `omciVersion: "G.988"`
- `tr069Supported: true`
- `tr369UspSupported: true`

## What this enables

1. **White-box OLT support**: if we add an Edgecore ASXvOLT16, we can talk to it via
   the same standard MIB without a vendor-specific adapter.
2. **Multi-vendor ONT under any vOLT**: vOMCI means our existing per-vendor adapter
   tree is not required when vOMCI is exposed.
3. **Future-proof 50G-PON / 25G-PON**: TR-451 specifies how ONUs/ONTs should be
   re-provisioned when the vOLT changes its PON technology.

## Sources

- **Broadband Forum TR-451 v1.0** (vOMCI specification) — primary reference
- **Broadband Forum MR-451.1** (Multi-Gigabit / 50G-PON extensions)
- **ONF SEBA (SDN-Enabled Broadband Access)** — reference architecture
- **TIP (Telecom Infra Project) vOLT requirements** — hardware-side specs
- **ITU-T G.988 (OMCI)** — the protocol vOMCI virtualizes

## Roadmap

| Phase | Work |
|-------|------|
| **Fase ODN (current)** | Model standards compliance in `OltDetail` |
| **Fase ODN-2** | Add Edgecore ASXvOLT16 / ASXvOLT64 with vOLT support |
| **Fase ODN-3** | Add first-pass vOMCI / OMCI proxy adapter (read-only) |
| **Fase ODN-4** | White-box + TIP-recognized OLT validation |
