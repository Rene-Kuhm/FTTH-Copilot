# Task: T4 — Worker skeleton (`services/worker`)

## Parent

`odd/tasks/backend-extraction.md`

## Status

in progress — 2026-10-31 (delegated to gentle-ai-worker)

## Spec

S1, S14

## What

Create `services/worker` as a deployable TypeScript package (Node 22): entrypoint
that boots an empty BullMQ `Worker` and exposes `/healthz` plus a Prometheus
metrics endpoint. Include its `Dockerfile`.

The process must be observable before it is given any work: a failing worker
that nobody can see is worse than no worker.

## Route

inline (orchestrator)

## Deliverable

`services/worker` buildable, testable, and runnable; `/healthz` answers.
