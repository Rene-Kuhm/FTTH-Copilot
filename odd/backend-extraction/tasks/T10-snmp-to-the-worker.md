# Task: T10 — The SNMP receiver moves to the worker

## Parent

`odd/tasks/backend-extraction.md`

## Status

in progress — 2026-10-31

## Spec

S3, S8, S14

## What

The SNMP trap receiver moves to the worker, for the same reason the syslog
receiver did: it binds a UDP port and only one process can own it. The traps
are spooled durably and drained through the queue.

The drain of the spool also stops being a timer in the web: it is a job of
the queue, plus a **periodic** drain schedule. The periodic one is the safety
net for a missed enqueue — when Redis was down the event was already safe on
disk, but nothing would have asked for it to be drained until another event
arrived.

The receiver, the trap mapping and the evidence store move verbatim into
`@ftth-copilot/ingest`, because the worker cannot import from the Next.js
app. The web keeps its public API by re-exporting from that package.

## Infrastructure

The published SNMP port (1162) leaves the web service in the same commit as
the selector that stops the web from binding the socket.

## Route

inline (orchestrator) + delegated writer

## Deliverable

`@ftth-copilot/ingest` with the SNMP receiver, the worker binding the
socket, the periodic drain schedule, the selector and the compose change.
