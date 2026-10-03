# DIRECT OLT ID normalization

## Objective

Resolve OLT identifiers case-insensitively at the connector boundary so the existing DIRECT route can read fixture and live IDs without weakening TruthGate or changing router classification.

## Problem

The DIRECT runtime uppercases extracted IDs (`OLT-Norte-01` → `OLT-NORTE-01`), while SmartOLT lookup is case-sensitive. A valid OLT is reported as not found and TruthGate abstains.

## Authorized scope

- Modify only the minimal OLT identifier resolution path and its regression tests.
- Preserve Adaptive/Organic Diagnostic Router behavior, fixtures, and TruthGate strictness.
- Re-run the exact Phase 3A DIRECT scenario with `DEMO_MODE_ENABLED=true` and capture updated evidence.
- Do not modify the landing, build video assets, or change unrelated connectors.
- Prepare a separate fix branch/PR; no auto-merge.

## Tasks

- [x] **OLT-1 — Locate resolution boundary**
  - Confirm where casing is lost and choose the smallest connector/runtime seam.
- [x] **OLT-2 — Implement case-insensitive OLT resolution**
  - Preserve original IDs, resolve casing variants consistently, and keep unknown IDs failing.
- [x] **OLT-3 — Add regression tests**
  - Cover original casing, different casing, same resolved OLT, and nonexistent IDs.
- [x] **OLT-4 — Re-capture DIRECT evidence**
  - Repeat `estado de OLT-Norte-01` with `DEMO_MODE_ENABLED=true`; preserve route, tool, envelope, TruthGate, and response.
- [x] **OLT-5 — Verify and prepare PR**
  - Run focused/all applicable checks, inspect scope, commit conventionally, and document remote PR prerequisites.

## Acceptance criteria

- Both casing variants resolve the same OLT fixture.
- Unknown OLT IDs still return the existing not-found error and TruthGate behavior remains unchanged.
- DIRECT capture returns the real OLT result with zero LLM calls.
- INVESTIGATION capture is not forced to a conclusion and remains unchanged.
- No landing, fixture, router, TruthGate, or video changes are included.

## Verification

- TDD mode: not configured; ordinary functional verification.
- Runner: Vitest (`pnpm --filter @ftth-copilot/agent-core exec vitest run`).
- Runtime scenario: `estado de OLT-Norte-01` with `DEMO_MODE_ENABLED=true`.

## Progress

- Current task: complete.
- Evidence: focused SmartOLT tests 11/11 green; agent-core router/runtime tests 111/111 green; SmartOLT suite 33/33 green; connector typecheck and eslint green; corrected DIRECT capture test green (1/1).
- Next step: review the commit and open a separate PR only after issue linkage and remote authorization are confirmed; no auto-merge.
