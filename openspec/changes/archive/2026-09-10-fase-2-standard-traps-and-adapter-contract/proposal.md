# Proposal: Fase 2 — Base estándar y contrato de adaptadores OLT

## Context & Motivation
Following the completion of Fase 0 (real binary SNMP receiver & raw evidence envelopes) and Fase 1 (research sources registry, IANA PEN resolver, and MIB tooling), Fase 2 establishes the common vendor-agnostic standard baseline and the formal `OltVendorAdapter` contract.

Standard IETF/RFC MIBs (SNMPv2-MIB, IF-MIB, ENTITY-MIB) are universally supported across all OLTs regardless of vendor. Establishing rigorous decoding and normalization of standard traps before writing private vendor adapters guarantees that generic infrastructure events (`coldStart`, `warmStart`, `linkDown`, `linkUp`, `authenticationFailure`, `entConfigChange`) are handled consistently without vendor-specific code duplication.

Furthermore, defining the `OltVendorAdapter` interface and its deterministic registry establishes strict boundaries preventing adapter bugs from breaching multi-tenant isolation, mutating network state, or inflating alarm severity without verifiable provenance.

## Proposed Changes

1. **Standard Traps Catalog & Varbind Extractors**:
   - Add standard traps: `coldStart`, `warmStart`, `linkDown`, `linkUp`, `authenticationFailure` (RFC 3418 / SNMPv2-MIB), and `entConfigChange` (RFC 6933 / ENTITY-MIB).
   - Add structured varbind extractors for IF-MIB (`ifIndex`, `ifAdminStatus`, `ifOperStatus`, `ifDescr`, `ifName`, `ifAlias`).
   - Audit all catalog entries with `source_id`, `source_grade`, `target_models`, `firmware`, and `license` according to Gate 1 rules.

2. **Multi-Source Identity & Ambiguity Rejection**:
   - Establish three-point identity resolution: Registered Sender Context (`senderIp` -> `tenantId`, `connectionId`, `oltId`, `declaredVendor`), `sysObjectID`, and Enterprise trap OID root (via `resolveVendorByOid`).
   - Implement strict ambiguity rejection: when sender context declares vendor X but trap OID belongs to vendor Y's PEN, or when white-label clones share colliding trees, tag event with `ambiguity_detected` and prevent foreign adapter execution.

3. **`OltVendorAdapter` Contract & Engine**:
   - Define TypeScript interface `OltVendorAdapter` requiring `vendorId`, `supportedPens`, `supportedFamilies`, `supports()`, and `normalize()`.
   - Implement safety invariants enforced by the adapter runner:
     - **Tenant Immutability**: Adapter cannot alter `tenantId`.
     - **Observation-Only**: Adapters are pure transformation functions; zero side effects, zero network mutations, zero command execution.
     - **Severity Guard**: Severity cannot be elevated without supporting source evidence.
   - Implement `StandardOltAdapter` handling all RFC standard traps.
   - Implement `OltAdapterRegistry` with deterministic resolution order: Vendor adapter -> Standard adapter -> Safe fallback.

4. **End-to-End Pipeline Integration (`Gate 2`)**:
   - Wire datagram decoding, identity resolution, evidence envelope creation, adapter dispatch, and `telemetry.v1` normalization.
   - Verify complete pipeline with binary loopback datagrams for all standard traps.
