# Fase 4 PR #3 — Topology-edge identity + collision detection + backfill planning

## Why

Roadmap Fase 4 (4.3). Identity projection + collision detection +
backfill planning are the pure helpers any topology-edge migration
MUST consume. Without them a migration that adds `connectionId`
can silently collapse distinct devices or duplicate one into two
rows.

## What changes

- `packages/evidence/src/edge-identity.ts` (new): the helpers above.
- `packages/evidence/src/index.ts`: re-exports.
- `packages/evidence/tests/edge-identity.test.ts` (new): 17 tests.

## Out of scope

- The migration itself (additive, behind a feature flag).
- Updates to `topology-correlation.ts`.
