# Fase 1 — OLT Research Sources Registry, IANA PEN & MIB Tooling

## Why

Roadmap `docs/roadmap-olt-multivendor.md` (Fase 1):
- Make every OID, trap, and vendor quirk auditable before expanding the telemetry catalog into 12 vendors.
- Establish verifiable provenance: no trap or definition enters the catalog without an explicit `source_id`, confidence grade (A-E), target families, firmware version (or explicitly marked `unknown`), license status, and cryptographic/URL trace.
- Eliminate ad-hoc string matching by rooting vendor identity in official IANA Private Enterprise Numbers (PENs).
- Automate compatibility matrix generation directly from verified data files (`sources.yaml` & `compatibility.yaml`), avoiding manual table drift.
- Establish a clean, isolated MIB compilation and translation protocol (using `snmptranslate` / parser) without redistributing proprietary binary or copyrighted MIB documents.

## What changes

1. **Research Schema & Validator (`packages/monitoring/src/snmp/research/`)**:
   - Zod schemas for source records, facts, compatibility matrices, and fixtures.
   - Validation for URL structure, uniqueness of `source_id`, valid IANA enterprise OIDs, and license review statuses (`permissive`, `restricted`, `review-required`).
2. **IANA Private Enterprise Numbers (PEN) Registry (`packages/monitoring/src/snmp/iana-pen.ts`)**:
   - Maps enterprise numbers (Huawei 2011, ZTE 3902, Nokia 637/6527, FiberHome 3807, Calix 1264, Adtran 664, DZS 5597, Zyxel 890, VSOL 37950, C-Data 34592, BDCOM 3320, Ubiquiti 41112) to canonical vendor profiles.
3. **Vendor Registries in `research/olt/<vendor>/`**:
   - Initial structured registries for all 12 target vendors containing `sources.yaml`, `compatibility.yaml`, and `fixtures/`.
4. **Compatibility Matrix Generator (`scripts/generate-compatibility-matrix.ts`)**:
   - CLI command (`pnpm generate:matrix` / `pnpm check:sources`) that reads all vendor YAML definitions, validates integrity, and outputs the updated markdown table.
5. **Documentation**:
   - Document governance for retired sources, deprecated MIBs, and licensing constraints in `docs/procedimiento-fuentes-mibs.md`.
6. **Testing**:
   - Unit tests covering schema validation, duplicate detection, invalid URLs, IANA PEN lookups, and matrix rendering.
