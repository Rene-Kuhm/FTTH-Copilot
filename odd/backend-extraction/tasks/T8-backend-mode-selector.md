# Task: T8 — The web stops starting the loops when the worker owns them

## Parent

`odd/tasks/backend-extraction.md`

## Status

done — 2026-10-31

## Spec

S4, S6

## What

Under `BACKEND_MODE=worker`, `apps/web/instrumentation.ts` does not start the
polling, firmware audit or FEC loops, and it marks them as *not expected* in
the process-local health registry so `/api/health` stays honest about what
this process is responsible for.

Under `embedded` — the default — the behavior is exactly the one of today.

The syslog and SNMP receivers stay in the web: the worker does not receive
them yet (T9, T10), and moving them before it can would silently drop every
trap and every syslog message.

## Route

inline (orchestrator)

## Deliverable

`apps/web/instrumentation.ts` plus `apps/web/tests/instrumentation.test.ts`,
which pins both modes.
