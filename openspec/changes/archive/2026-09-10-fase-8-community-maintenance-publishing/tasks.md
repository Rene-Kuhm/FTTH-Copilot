# Tasks: Fase 8 — Comunidad, Mantenimiento y Publicación

- [x] **Task 1: Contribution Templates & Documentation**
  - [x] 1.1 Create `.github/PULL_REQUEST_TEMPLATE/snmp_contribution.md` with structured contribution checklist.
  - [x] 1.2 Create `.github/ISSUE_TEMPLATE/snmp_source_contribution.md` for submitting new MIBs, manuals, or captures.
  - [x] 1.3 Create contributor documentation `docs/contributing-snmp.md` explaining the workflow, sanitization, and criteria for L2 elevation.

- [x] **Task 2: SNMP Capture & Evidence Sanitizer**
  - [x] 2.1 Implement `packages/monitoring/src/snmp/sanitizer.ts` with redaction rules for communities, IPv4/IPv6, hostnames, credentials, and serials (preserving vendor prefixes).
  - [x] 2.2 Create CLI executable `scripts/sanitize-snmp-capture.ts` for sanitizing text logs and JSON envelopes.
  - [x] 2.3 Implement unit tests `packages/monitoring/tests/snmp/sanitizer.test.ts`.

- [x] **Task 3: Automated Contribution & Gate Validator**
  - [x] 3.1 Implement contribution validation logic ensuring PRs contain valid model, firmware, source, license, and minimal reproduction fixture.
  - [x] 3.2 Add script `scripts/validate-contribution.ts` and integrate with `pnpm check:contribution`.

- [x] **Task 4: OID Collision & Semantic Conflict Detector**
  - [x] 4.1 Implement `packages/monitoring/src/snmp/research/oid-conflicts.ts` to detect duplicate OIDs across vendors, category mismatches, and PEN ownership collisions.
  - [x] 4.2 Create script `scripts/check-oid-conflicts.ts` and add command `pnpm check:conflicts` to root `package.json`.
  - [x] 4.3 Add unit tests `packages/monitoring/tests/snmp/oid-conflicts.test.ts`.

- [x] **Task 5: Compatibility Matrix Public Documentation**
  - [x] 5.1 Update `scripts/generate-compatibility-matrix.ts` to generate `docs/compatibility-matrix.md` with statistics and summary tables.
  - [x] 5.2 Add npm script `pnpm generate:matrix:write` and generate `docs/compatibility-matrix.md`.

- [x] **Task 6: Quarterly Maintenance & Source Health Automation**
  - [x] 6.1 Implement `scripts/check-research-sources-health.ts` for checking external URL reachability and flagging dead or outdated links.
  - [x] 6.2 Create GitHub Actions workflow `.github/workflows/quarterly-sources-audit.yml`.

- [x] **Task 7: Errata Registry & False-Positive Filtering**
  - [x] 7.1 Define schema and create `research/olt/errata.yaml` documenting known false positives, MIB typos, and deprecated rules.
  - [x] 7.2 Implement errata loader and rule engine in `packages/monitoring/src/snmp/research/errata.ts`.
  - [x] 7.3 Connect errata filtering into adapter pipeline to suppress or remap errata traps.
  - [x] 7.4 Add unit tests `packages/monitoring/tests/snmp/errata.test.ts`.

- [x] **Task 8: Gate 8 Validation & End-to-End Conformance**
  - [x] 8.1 Create integration test `packages/monitoring/tests/conformance/gate8-contribution-lifecycle.test.ts` verifying external contribution lifecycle from raw capture to L2.
  - [x] 8.2 Verify all tests and monorepo tasks pass (`pnpm turbo run lint typecheck test`).
