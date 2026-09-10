# OLT Research Sources Registry & MIB Tooling Specification

## ADDED Requirements

### Requirement 1: Research Source Schema & Validation
The system SHALL validate all source records against a strict Zod schema enforcing `source_id`, `vendor`, `families`, `firmware` (string or explicitly `'unknown'`), `source_grade` ('A'|'B'|'C'|'D'|'E'), `url`, `retrieved_at` (YYYY-MM-DD), `license` ('permissive'|'restricted'|'review-required'|'standard'), and `facts`.
- **Given**: A `sources.yaml` file located in `research/olt/<vendor>/`.
- **When**: The validator is executed.
- **Then**: It ensures every field strictly conforms to the schema or raises an informative validation error.

### Requirement 2: Uniqueness of Source Identifiers
The system SHALL reject any source record whose `source_id` collides with another source within the same vendor or across any other vendor.
- **Given**: Two source records sharing the same `source_id`.
- **When**: The sources validation suite runs.
- **Then**: A duplicate ID error is raised identifying the colliding files.

### Requirement 3: IANA Private Enterprise Numbers (PEN) Authority
The system SHALL map vendor Enterprise OIDs (under `1.3.6.1.4.1.<PEN>`) to canonical vendor identities using an authoritative IANA PEN registry, rejecting ambiguous or unassigned PEN roots.
- **Given**: An incoming or declared OID with enterprise prefix `1.3.6.1.4.1.2011`.
- **When**: The IANA PEN resolver evaluates the OID.
- **Then**: It resolves definitively to `vendor: 'Huawei'`, `pen: 2011`.

### Requirement 4: Free-Text Vendor Guessing Prevention
The system SHALL refuse to associate an enterprise OID with a vendor solely by free-text matching or informal heuristics when the root PEN belongs to a different or standard entity.
- **Given**: An OID under standard MIB tree `1.3.6.1.2.1.2.2` or another vendor's PEN.
- **When**: Vendor identification is queried.
- **Then**: It returns `null` or standard classification without guessing a private vendor.

### Requirement 5: Compatibility Level Model (L0–L4)
The system SHALL validate `compatibility.yaml` files ensuring that support levels strictly follow L0 (Detected), L1 (Documented), L2 (Simulated), L3 (Real Capture), or L4 (Field Certified).
- **Given**: A vendor compatibility declaration.
- **When**: The schema validation runs.
- **Then**: Each family entry declares a valid level L0–L4, confidence grade, and reference to supporting source IDs.

### Requirement 6: Dynamic Compatibility Matrix Generation
The system SHALL provide a CLI command (`pnpm generate:matrix`) that parses all `research/olt/<vendor>/` files and produces a Markdown table representing the multi-vendor support matrix.
- **Given**: Valid source and compatibility YAML files across 12 vendors.
- **When**: `pnpm generate:matrix` is executed.
- **Then**: It outputs an up-to-date, alphabetically and priority-sorted Markdown table without manual editing.

### Requirement 7: Gate 1 Catalog Admission Guard
The catalog ingestion mechanism SHALL reject any trap or MIB definition that lacks a valid `source_id`, grade (A-E), target models, explicit firmware state, and verified license status.
- **Given**: A prospective trap definition without an audit `source_id` or with an invalid grade.
- **When**: The catalog registration or audit check is invoked.
- **Then**: The definition is rejected at compile/test time.
