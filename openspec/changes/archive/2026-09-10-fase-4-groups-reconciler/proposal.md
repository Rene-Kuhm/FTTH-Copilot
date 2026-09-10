# Fase 4 PR #4 — Topology-correlation group reconciler

## Why

Roadmap Fase 4 (4.4). Without a reconciler, a nightly re-run emits
overlapping groups and confirmed incidents are never linked to
their topology evidence.

## What changes

- `packages/evidence/src/groups-reconciler.ts` (new): pure helpers.
- `packages/evidence/src/index.ts`: re-exports.
- `packages/evidence/tests/groups-reconciler.test.ts` (new): 14 tests.

## Out of scope

- Persistence.
- Nightly scheduling.
