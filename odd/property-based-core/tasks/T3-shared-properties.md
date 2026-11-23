# Task: T3 — Shared canonical-contract Zod round-trip property suite

## Parent

`property-based-core.md`

## Status

pending

## Specs

S1, S2

## Allowed edit surfaces

- `packages/shared/tests/property/**`

## What

Property-based tests for the canonical Zod contracts in `@ftth-copilot/shared`, focused on round-trip stability and tenant-id preservation.

## Details

- Candidate invariants to confirm against source (refine only with source proof; report refinements):
  - S-1 `parse` is a round trip: `schema.parse(input)` deep-equals `input` for every accepted input (no coercion, no transform).
  - S-2 `parse` is idempotent: `schema.parse(schema.parse(input))` deep-equals `schema.parse(input)`.
  - S-3 a tenant id present in the input survives parsing unchanged and is never replaced by a default.
  - S-4 strict schemas reject an unknown extra key.
  - S-5 `topologyEdgeSchema` rejects an edge whose `validTo` is not greater than `validFrom`.
  - S-6 the investigation result schema enforces its documented caps (hypotheses, contradictions, missing, checks, evidence references).
  - S-7 the investigation free-text field enforces its UTF-8 byte cap.
  - S-8 the investigation window rejects `windowEnd < windowStart`, and `cutoffAt > producedAt` is rejected.
  - S-9 enum schemas accept exactly their declared members.
- Generate inputs with fast-check arbitraries that satisfy the schema (build a valid sample, then mutate one field at a time), instead of hand-writing corpora.
- Use `import fc from 'fast-check'`; declare every invariant explicitly; use an explicit fixed seed per property and document it.
- Fixtures: invented tenant ids only.
- Do not modify `packages/shared/src/**`. Do not commit.

## Deliverable

A green `packages/shared/tests/property/**` suite plus the observed test output.

## Commit

`test(shared): property-based round-trip invariants for canonical contracts`
