# Task: T5 — Worker in compose and CI

## Parent

`odd/tasks/backend-extraction.md`

## Status

done — 2026-10-31

## Spec

S1, S17

## What

Add the `worker` service to the compose files, wire a CI job that builds and
tests it, and document `BACKEND_MODE`.

## Route

inline (orchestrator)

## Deliverable

Compose serves the worker; CI builds and tests it on every PR.
