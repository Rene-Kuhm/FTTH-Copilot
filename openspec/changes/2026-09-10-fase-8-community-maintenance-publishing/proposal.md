# Proposal: Fase 8 — Comunidad, Mantenimiento y Publicación

## 1. Context & Motivation
Following the completion of **Fase 7 (Hardwareless Conformance Lab)**, the FTTH-Copilot multi-vendor OLT architecture supports 8 vendors at Support Level L2 (Simulated) with 100% reproducible UDP loopback tests, golden snapshots, property-based tests, and performance SLAs.

To scale the multi-vendor ecosystem without degrading evidence rigor, **Fase 8** establishes the contribution lifecycle, ongoing maintenance routines, automated collision checks, errata tracking, and public documentation so that operators and community contributors can submit new OLT adapters or trap profiles safely and autonomously.

## 2. Scope & Objectives
1. **Contribution Templates & Guidelines**:
   - Standardized pull request and issue templates for MIBs, manuals, `snmpwalk` logs, and sanitized packet captures.
   - Contributor documentation detailing the submission lifecycle from initial evidence to Level L2 validation.
2. **Automated SNMP Capture Sanitizer**:
   - Standalone sanitizer engine and CLI utility (`scripts/sanitize-snmp-capture.ts`) to redact sensitive data (SNMP community strings, IP addresses, internal hostnames, customer credentials, circuit IDs, and subscriber serials while preserving vendor prefixes).
3. **PR Validation & Contribution Gate**:
   - Automated contribution validator verifying model, firmware, source ID, license, and minimal reproduction test cases.
4. **Collision & Semantic Conflict Detector**:
   - Automated detection of duplicate trap OIDs across unrelated vendors, contradictory event category/severity assignments, and IANA PEN ownership discrepancies.
5. **Public Compatibility Matrix**:
   - Automated script generating `docs/compatibility-matrix.md` with complete vendor/family/firmware/support level rankings directly from research YAML data.
6. **Quarterly Source Health & Maintenance Automation**:
   - Script and GitHub Actions workflow to detect broken reference links, expired resources, or replaced firmware versions.
7. **Errata & False-Positive Registry**:
   - Machine-readable errata catalog (`research/olt/errata.yaml`) with loader/filtering engine to suppress or remap known vendor firmware bugs and false-positive traps.
8. **Gate 8 Compliance**:
   - Verified pipeline showing an external contribution progressing from sanitized capture to Level L2 without requiring operator network access.

## 3. Non-Goals
- Executing live writes or modifying physical OLTs (strictly adheres to read-only observation mode).
- Granting automated Level L3 or L4 status without verified hardware certification (deferred to Fase 9).
