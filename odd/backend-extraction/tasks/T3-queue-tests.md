# Task: T3 — Queue tests (RED to GREEN)

## Parent

`odd/tasks/backend-extraction.md`

## Status

done — 2026-10-31

## Spec

S3

## What

Tests for `packages/jobs` covering: enqueue, consume, retry, dead-letter.

Follow the repo convention for external dependencies (as in `packages/db` and
`packages/alerts`): unit tests stay hermetic, integration tests live in
`tests/**/*.integration.test.ts` behind their own vitest config, and each suite
gates itself on an env var so a misconfigured run skips instead of fails.

## Route

inline (orchestrator)

## Deliverable

`packages/jobs` unit suite green without Redis; integration suite green against
a real Redis.
