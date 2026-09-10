# Spec delta — Cognitive investigation (fase 0)

## Identificadores estables

This spec delta introduces three stable identifiers and their wire
formats. Subsequent phases will extend the envelopes; phase 0 ships
only the fields required to pin the namespaces.

### Scenario: a producer sends a run envelope under the wrong schema version

Given a producer emits a payload with `schema: 'ftth.investigation-run.v999'`
When the consumer parses it via `investigationRunSchema`
Then parsing MUST fail with a `ZodError` referencing `schema`
And the consumer MUST NOT silently coerce the unknown version

### Scenario: an identifier leaks tenant context through its shape

Given an identifier of length 64
When the regex `/^[A-Za-z0-9_-]+$/` is applied
Then the identifier MUST match
And no part of the identifier (prefix, suffix, or pattern) MUST
expose the `tenantId`, `connectionId`, or any Prisma row number

### Scenario: a producer adds an undocumented top-level key

Given a payload that includes `runId`, `tenantId`, `requestedAt` and
the additional field `debug: 'leak'`
When the consumer parses it via `investigationRunSchema`
Then parsing MUST fail because the schema is `.strict()`
And no field is silently dropped

### Scenario: a version references a run from a different tenant

Given a `InvestigationVersion` payload with `runId: 'r_a'`
And the underlying `InvestigationRun` for `r_a` has `tenantId: 't-1'`
When the consumer fetches the version
Then the server MUST validate that `version.tenantId` equals
`user.tenantId` (the JWT-derived tenant, not the client body)
And return 404 — never 200 with data — when the tenants do not match

### Scenario: feedback is recorded against a specific version, not the latest run

Given a run produced version 0 on 2026-09-01 and version 1 on 2026-09-05
And the technician records `confirmed` on 2026-09-04
Then the feedback MUST attach to version 0
And a later recording (also `confirmed`) MUST attach to version 0 again
And version 1 MUST remain open for separate adjudication

## Rules (RFC 2119)

- The three envelope schemas MUST live in `packages/shared/src/contracts.ts`.
- Each schema MUST declare a literal `schema` field whose value is the
  matching `*_SCHEMA` constant.
- Each schema MUST use `.strict()`.
- `runId`, `versionId`, `feedbackId` MUST match `/^[A-Za-z0-9_-]+$/` and
  MUST be 1–64 characters long.
- The three namespaces MUST be disjoint (a `runId` MUST NOT equal any
  `versionId` or `feedbackId`).
- Schema version drift MUST be detected: an unknown version produces
  a parse error, never a silent fallback.

## Out of scope for this spec delta

- Persistence tables (phase 1).
- API routes (phase 3).
- Adjudication labels (phase 1).
- Top-level fields beyond identifiers (phase 3).
