# Fase 4 PR #5 — Investigation enrichment

## Why

Roadmap Fase 4 (4.5). The investigation card needs a canonical
envelope for shared infrastructure, affected observed, and known
healthy — with strict tenant + topology scoping and zero splitter
inference.

## What changes

- `packages/evidence/src/investigation-enrichment.ts` (new).
- `packages/evidence/src/index.ts`: re-exports.
- `packages/evidence/tests/investigation-enrichment.test.ts` (new): 8 tests.

## Out of scope

- Splitter registration (separate change).
- Persistence.
- UI.
