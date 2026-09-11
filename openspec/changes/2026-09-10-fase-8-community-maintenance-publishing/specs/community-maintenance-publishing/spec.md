# Specification: Fase 8 — Comunidad, Mantenimiento y Publicación

## Acceptance Criteria

### Requirement 1: Contribution Templates & Documentation
- The repository MUST provide `.github/PULL_REQUEST_TEMPLATE/snmp_contribution.md` and `.github/ISSUE_TEMPLATE/snmp_source_contribution.md`.
- Contribution templates MUST require: target vendor, model family, tested firmware version, source provenance link/document, license compliance, and minimal reproduction fixture.
- Contributor documentation (`docs/contributing-snmp.md`) MUST guide contributors through sanitizing captures, adding MIB definitions, writing adapter tests, and achieving Support Level L2.

### Requirement 2: SNMP Capture & Evidence Sanitizer
- The repository MUST implement an SNMP capture sanitizer (`packages/monitoring/src/snmp/sanitizer.ts`) and a CLI utility (`scripts/sanitize-snmp-capture.ts`).
- The sanitizer MUST redact:
  - SNMP community strings (e.g. `public`, `private`, custom hex strings replaced with `<REDACTED_COMMUNITY>`).
  - IPv4 and IPv6 addresses (public or RFC 1918 private IPs replaced with RFC 5737 documentation IPs `192.0.2.x`, `198.51.100.x` or `<REDACTED_IP>`).
  - Fully qualified domain names and internal hostnames.
  - Customer personal identifiable information (PII), PPPoE credentials, circuit IDs, and subscriber names.
  - Serial numbers: MUST preserve the 4-byte vendor prefix (e.g. `HWTC`, `ZTEG`, `ALCL`, `FHTT`, `CXNK`, `ADTN`, `VSOL`, `BDCM`) while deterministically masking the host/device serial payload.
- The sanitizer MUST support both raw text logs (e.g., `snmpwalk` output) and structured JSON evidence envelopes.

### Requirement 3: Contribution Gate & Validation CLI
- A contribution validator MUST verify that every submitted vendor entry includes:
  - Valid `sources.yaml` with schema-conforming `source_id`, non-empty target models, confidence grade (A, B, C, or D), and license tag.
  - Valid `compatibility.yaml` referencing only declared `source_id`s.
  - A reproduction fixture file in `packages/monitoring/tests/fixtures/`.
- PRs failing any of these criteria MUST exit with a non-zero code.

### Requirement 4: Automated Detection of Duplicate OIDs & Semantic Conflicts
- The repository MUST provide an automated analyzer (`packages/monitoring/src/snmp/research/oid-conflicts.ts` and `scripts/check-oid-conflicts.ts`) to detect:
  - OID collisions across unrelated vendors (different enterprise PEN branches claiming the same full OID).
  - Conflicting severity or event categories mapped to the same OID across adapters.
  - Mismatches between vendor enterprise PEN roots and declared OID prefixes.

### Requirement 5: Public Compatibility Matrix Publication
- The script `scripts/generate-compatibility-matrix.ts` MUST support generating and updating `docs/compatibility-matrix.md`.
- The generated table MUST list all supported vendors, hardware families, firmware versions, support levels (L0 to L4), confidence grades, and source counts.
- Summary statistics (total vendors, count per support level, total verified trap definitions) MUST be included.

### Requirement 6: Quarterly Source Health & Maintenance Automation
- A health checker script (`scripts/check-research-sources-health.ts`) MUST verify the reachability of referenced source URLs and flag dead links, moved documentation, or outdated firmware versions.
- A GitHub Actions workflow (`.github/workflows/quarterly-sources-audit.yml`) MUST run quarterly on a schedule and on manual dispatch.

### Requirement 7: Errata Registry & False-Positive Rule Management
- The repository MUST maintain a machine-readable errata catalog (`research/olt/errata.yaml`).
- The errata catalog MUST track known vendor MIB bugs, false-positive alarms, firmware-specific regressions, and retired trap rules.
- The SNMP processing pipeline MUST respect errata definitions to prevent emitting spurious alarms.

### Requirement 8: Gate 8 Compliance
- Conformance tests MUST verify that an external contribution starting from a sanitized capture can be parsed, validated, tested, and elevated to Support Level L2 without access to an operator's live environment.
