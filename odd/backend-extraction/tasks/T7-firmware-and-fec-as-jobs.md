# Task: T7 — The firmware audit and FEC loops become queue jobs

## Parent

`odd/tasks/backend-extraction.md`

## Status

done — 2026-10-31

## Spec

S3, S7, S14

## What

Same as T6, for the firmware audit (`ftth-firmware` / `firmware-audit`) and
the FEC collection (`ftth-fec` / `fec-collection`). Each loop keeps its own
env flag and its own cadence, and each is registered as a Job Scheduler whose
id is stable across processes.

## Route

inline (orchestrator) + delegated writer

## Deliverable

Both loops running as jobs of the durable queue.
