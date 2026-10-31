# Task: T6 — The polling loop becomes a queue job

## Parent

`odd/tasks/backend-extraction.md`

## Status

done — 2026-10-31

## Spec

S3, S7, S14

## What

The metrics polling loop is no longer a `setInterval` in the web process. It
is a job of the `ftth-poll` queue, produced by a Job Scheduler the worker
registers at boot, and executed by the worker.

The body of the loop did not change: it moved verbatim from
`apps/web/lib/monitoring/scheduler.ts` to `@ftth-copilot/scheduler`, because
the worker cannot import from a Next.js app. The connector factory moved the
same way, to `@ftth-copilot/connectors-factory`.

## Route

inline (orchestrator) + delegated writer

## Deliverable

`@ftth-copilot/scheduler`, `@ftth-copilot/connectors-factory`, the worker
handlers and the recurring schedule. One tick per interval, one tick at boot.
