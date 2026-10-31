# Task: T1 — Queue foundation (`packages/jobs`)

## Parent

`odd/tasks/backend-extraction.md`

## Status

done — 2026-10-31

## Spec

S2, S14

## What

Create `@ftth-copilot/jobs`: the single typed entry point for the BullMQ queue.

- Typed queue names and job names, plus the payload type of every job.
- A `Queue`-per-name registry so the web and the worker cannot disagree on
  names, and so a job name can never be enqueued on the wrong queue.
- `enqueue` helper (one-shot jobs, optional stable `jobId` for dedupe).
- `scheduleRecurring` helper built on BullMQ v6 Job Schedulers
  (`upsertJobScheduler`), which is the v6-native replacement for the removed
  `repeat` option.
- `defineWorker` helper that wires a BullMQ `Worker` with the connection
  options BullMQ requires (`maxRetriesPerRequest: null`).
- Redis connection built from `REDIS_URL`.

## Route

inline (orchestrator)

## Deliverable

`packages/jobs` publishable in the workspace, lint/typecheck/test green.
