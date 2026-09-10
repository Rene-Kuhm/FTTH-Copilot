# Fase 3 PR #5 — Immutable investigation version persistence & snapshot store

## Why

Roadmap Fase 3 (3.5): "Persistir una versión inmutable del resultado con snapshot
acotado o referencias durables. Una actualización crea otra versión y no cambia
aquello que el técnico ya evaluó."

Following PR #120 (`ftth.investigation-result.v1` contract), PR #123 (evidence collector),
PR #124 (facts & cognitive engine), and PR #125 (server-side validator), the persistence
layer must safely store diagnosis results in PostgreSQL via Prisma.

Key requirements:
1. Immutable versioning: once an `InvestigationVersion` is created, it is never mutated.
   Re-investigating or updating an incident creates a new version (`versionIndex + 1`),
   preserving earlier versions and their associated technician feedback (`InvestigationFeedback`).
2. Bounded snapshots: the `snapshotJson` column stores the full, validated `InvestigationResult`
   envelope conforming to size caps (≤64 evidence refs, ≤8 hypotheses, ≤16 contradictions,
   ≤16 missing, ≤8 checks, ≤4096 bytes free text).
3. Multi-tenant isolation: all persistence operations strictly enforce `tenantId` isolation
   and reject cross-tenant writes or reads.
4. Run status synchronization: creating a valid version transitions `InvestigationRun.status`
   from `pending` to `ready`.

## What changes

- `packages/db/src/investigation-store.ts` (new):
  - `persistInvestigationVersion(prisma, args)`: validates `investigationResult`, determines
    atomic next `versionIndex`, stores immutable snapshot, and updates run status.
  - `getLatestInvestigationVersion(prisma, args)`: retrieves the latest version and parsed snapshot.
  - `getInvestigationVersionById(prisma, args)`: retrieves a specific historical version snapshot.
  - `listInvestigationVersions(prisma, args)`: lists all immutable versions for a given run.
- `packages/db/src/index.ts`:
  - Re-exports the investigation store functions and types.
- `packages/db/tests/investigation-store.test.ts` (new):
  - Integration tests verifying version sequence incrementation, snapshot immutability,
    multi-tenant isolation, and validation on insert.

## Out of scope

- HTTP route handler `/api/incidents/[id]/investigate` with rate limiting/concurrency locks (Fase 3 PR #6 / 3.6).
- UI investigation dashboard cards (Fase 3 PR #7 / 3.7).
