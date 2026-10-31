# Task: T9 — The syslog receiver moves to the worker

## Parent

`odd/tasks/backend-extraction.md`

## Status

done — 2026-10-31

## Spec

S3, S8, S14

## What

The worker binds the syslog UDP socket, spools every datagram durably and
enqueues the job that drains the spool into Postgres. The web does not bind
the socket when `BACKEND_MODE=worker`: two processes cannot bind the same UDP
port, and the kernel hands each datagram to one socket only.

The receiver and the durable spool moved verbatim into `@ftth-copilot/ingest`,
because the worker cannot import from the Next.js app. The web keeps its
public API by re-exporting from that package.

The drain job carries the `ingestId` of the event it drains, so the same
event is never ingested twice even if the job is retried. The spool write
happens before the enqueue: if Redis is down the event is already safe on
disk, the failure is surfaced in the health registry, and the drain only
delays the write.

## Infrastructure (the three traps)

- The worker runs on the **host network**: Docker's userland proxy for UDP
  rewrites the source address to the bridge gateway, and the receiver
  attributes events by source IP. Verified with `pnpm verify:syslog-source-ip`.
- The spool lives on a **persistent volume**, and both images create the
  directory owned by the user they run as (uid 1001), so the volume is
  writable no matter which container initializes it first.
- The published port **moves from the web to the worker** in the same commit
  as the selector.

## Route

inline (orchestrator) + delegated writer

## Deliverable

`@ftth-copilot/ingest`, the worker's receiver and drain handler, the
selector, and the compose changes.
