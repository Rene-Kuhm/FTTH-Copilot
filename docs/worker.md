# Background worker

The background work of FTTH-Copilot — polling the NMS, the firmware audit, FEC
collection, the syslog and SNMP receivers and the event drainer — runs in a
separate process, `services/worker`, on top of a durable job queue (BullMQ +
Redis). The web app stays a thin BFF: it serves HTTP and SSE, and it enqueues
work instead of doing it inline.

This document is the operational contract for that split. The design and the
task breakdown live in `odd/tasks/backend-extraction.md`.

## Topology

```
                    ┌───────────────────────────┐
   browser ────────▶│  apps/web (Next.js)       │  UI + BFF
                    │  61 routes + SSE          │──┐
                    └───────────────────────────┘  │  enqueue
                                                   ▼
                                            ┌──────────────┐
                                            │ Redis        │  BullMQ
                                            │ (job queue)  │
                                            └──────┬───────┘
                                                   │  jobs
                    ┌───────────────────────────┐  │
                    │  services/worker          │◀─┘
                    │  - poll / firmware / FEC  │
                    │  - syslog + SNMP receiver │
                    │  - event drainer          │
                    └───────────┬───────────────┘
                                │ reads / writes
                                ▼
                        ┌───────────────┐
                        │   Postgres    │  source of truth
                        └───────────────┘
```

Three properties follow from the split:

- **A web deploy does not stop the monitoring.** The worker has its own
  lifecycle.
- **The web tier scales horizontally.** The loops run once, in the worker.
- **A slow poll no longer competes with HTTP.** Different processes, different
  event loops.

## Environment

| Variable       | Default                  | Meaning                                                                 |
| -------------- | ------------------------ | ----------------------------------------------------------------------- |
| `REDIS_URL`    | `redis://127.0.0.1:6379` | Redis instance that holds the queue.                                    |
| `BACKEND_MODE` | `embedded`               | `embedded` = the web runs the loops (today). `worker` = the worker runs them. |
| `WORKER_PORT`  | `8081`                   | Port of the worker's health and metrics server.                          |
| `WORKER_HOST`  | `0.0.0.0`                | Interface the health server binds to.                                   |
| `WORKER_CONCURRENCY` | `1`                | Jobs of a queue that run at the same time.                              |

`BACKEND_MODE` is read by `@ftth-copilot/jobs` (`backendMode()`), so both the
web and the worker agree on it. The default stays `embedded` until the worker
has run green in staging.

> **Pending:** `REDIS_URL` and `BACKEND_MODE` are documented in
> `docs/demo-env-template.md`, but they are still missing from the repository
> root `.env.example` — the agent sandbox blocks writes to that path. Add
> these two lines to it:
>
> ```bash
> REDIS_URL=redis://localhost:6379
> BACKEND_MODE=embedded
> ```

### Why the default is `embedded`

`embedded` is the behavior that is already proven in production. Flipping the
default before the worker has proven itself would turn a failed extraction into
a monitoring outage, which is exactly the failure this work exists to prevent.

## Deploying the worker

The worker is behind a compose profile so it is never started by accident:

```bash
# Only when BACKEND_MODE=worker
docker compose --profile worker up -d worker
```

Starting the worker while `BACKEND_MODE=embedded` is still set is the one
combination that is actively harmful: the web would keep its own loops *and*
the worker would run its own, so the NMS would be polled twice and both
processes would try to bind the UDP socket.

## Health and metrics

The worker serves two endpoints:

| Endpoint   | Purpose                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `/healthz` | Liveness/readiness as JSON: uptime, consumed queues, Redis readiness.   |
| `/metrics` | Prometheus exposition format (`text/plain; version=0.0.4`).              |

`/healthz` answers even when Redis is unreachable — the status becomes
`degraded`. A worker that cannot be seen is worse than no worker, because the
failure would be silent.

## Rollback

The extraction is reversible without a code revert:

1. Set `BACKEND_MODE=embedded` in the environment.
2. Stop the worker (`docker compose --profile worker stop worker`).
3. Restart the web app so it picks up the flag.

The web goes back to running the loops in-process, which is exactly the
behavior it had before the extraction. No data migration is involved: the
queue payload lives in Redis, and the rows the worker would have written are
the same rows the embedded path writes.

## What is still in the web

Until the extraction is complete (phase 6 of `odd/tasks/backend-extraction.md`),
`apps/web/instrumentation.ts` still starts the loops when `BACKEND_MODE` is
`embedded`. That is the rollback path, and it is removed only after the worker
has run green in staging.
