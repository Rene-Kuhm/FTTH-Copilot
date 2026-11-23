# Task: T4 — Evidence incident-correlation property suite

## Parent

`property-based-core.md`

## Status

pending

## Specs

S1, S2

## Allowed edit surfaces

- `packages/evidence/tests/property/**`

## What

Property-based tests for incident and evidence correlation in `@ftth-copilot/evidence`, including the tenant-isolation laws.

## Details

- Candidate invariants to confirm against source (refine only with source proof; report refinements):
  - E-1 `composeGroupIdentityKey` and `composeEdgeIdentityKey` embed the tenant id, so two different tenants can never produce the same key for the same business entity.
  - E-2 `dedupGroups` removes nothing: output length equals input length, the first occurrence stays canonical, later duplicates carry `duplicateOf` pointing at the canonical id, and the canonical lists the merged ids.
  - E-3 `dedupGroups` does not mutate its input and is idempotent on its own output.
  - E-4 `reconcileGroups` never associates an incident of one tenant with a group of another tenant.
  - E-5 `correlateByTopologyAndTime` returns only groups built from events of the target tenant, every referenced evidence event id exists in the input, and the output validates against `topologyCorrelationGroupSchema`.
  - E-6 `correlateByTopologyAndTime` is order-independent: permuting the input events produces the same groups (compare the sorted output).
  - E-7 `collectInvestigationEvidence` never returns a reference whose tenant differs from the requested tenant, returns unique reference ids, sorts by the documented order, and caps the result at the documented maximum.
  - E-8 `collectInvestigationEvidence` rejects a blank tenant id, a window that ends before it starts, and a window longer than the documented maximum.
  - E-9 `assessFreshness` is deterministic for a fixed `nowMs`, and a sample dated in the future yields the documented error level.
  - E-10 `detectCounterReset` returns the index of the first decrease, and `null` for a non-decreasing series.
  - E-11 `retrieveRelevantIncidents` never returns an incident of another tenant, respects the limit, and orders by relevance score; it rejects a missing tenant id.
- Use `import fc from 'fast-check'`; declare every invariant explicitly; use an explicit fixed seed per property and document it.
- Fixtures: invented tenant ids (`tenant-a`, `tenant-b`), invented device/connection ids, documentation-range IPs only.
- Do not modify `packages/evidence/src/**`. Do not commit.

## Deliverable

A green `packages/evidence/tests/property/**` suite plus the observed test output.

## Commit

`test(evidence): property-based invariants for incident correlation`
