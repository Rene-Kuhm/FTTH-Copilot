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
                    │  (host network)           │
                    │  - poll / firmware / FEC  │
                    │  - syslog receiver        │
                    │  - event drainer          │
                    └───────────┬───────────────┘
                                │ reads / writes
                                ▼
                        ┌───────────────┐
                        │   Postgres    │  source of truth
                        └───────────────┘

   OLT ──── syslog/UDP ────▶  host :5514 ────▶ worker (binds it directly)
   NMS ──── traps/UDP ─────▶  host :1162 ────▶ worker (binds it directly)
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
| `REDIS_URL`    | `redis://127.0.0.1:6379` | Redis instance that holds the queue. In compose the web reaches Redis by service name (`redis:6379`); the worker, which runs on the host network, uses `127.0.0.1`. |
| `REDIS_PASSWORD` | —                      | Password of the Redis instance. Required in the compose stacks; generate it with `openssl rand -hex 32`. |
| `BACKEND_MODE` | `embedded`               | `embedded` = the web runs the loops (today). `worker` = the worker runs them. |
| `WORKER_PORT`  | `8081`                   | Port of the worker's health and metrics server.                          |
| `WORKER_HOST`  | `0.0.0.0`                | Interface the health server binds to.                                   |
| `WORKER_CONCURRENCY` | `1`                | Jobs of a queue that run at the same time.                              |

### Redis is published on the loopback, with a password

A port published by Docker does **not** go through the host firewall, so a
Redis published on all interfaces is reachable from the internet even when
ufw says otherwise. The compose stacks therefore publish it on `127.0.0.1`
only, and start it with `--requirepass`.

The password comes from `REDIS_PASSWORD` and the compose files build
`REDIS_URL` out of it, so it is defined in exactly one place.

```bash
# Generate it like this: hex has no characters that need escaping in a URL.
REDIS_PASSWORD=$(openssl rand -hex 32)
```

Use a hex value on purpose. The password is embedded in
`redis://:<password>@host:port`, and characters like `@ : / # % ?` change the
meaning of that URL — the worker would fail to connect with a confusing error
while the Redis container looks perfectly healthy. Hex only uses `0-9a-f`.

If the password must contain other characters, percent-encode it before it
goes into the URL.

`BACKEND_MODE` is read by `@ftth-copilot/jobs` (`backendMode()`), so both the
web and the worker agree on it. The default stays `embedded` until the worker
has run green in staging.

> **Pending:** `REDIS_URL`, `REDIS_PASSWORD` and `BACKEND_MODE` are documented
> in `docs/demo-env-template.md`, but they are still missing from the
> repository root `.env.example` — the agent sandbox blocks writes to that
> path. Add these three lines to it:
>
> ```bash
> REDIS_URL=redis://localhost:6379
> REDIS_PASSWORD=change-me
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

## The worker runs on the host network

The worker service uses `network_mode: host`. This is not a convenience, it is
a correctness requirement.

The syslog receiver attributes an event to the IP found in the message body
and falls back to the **UDP source address** when the body has no IP literal.
Docker's userland proxy for UDP rewrites that source address to the bridge
gateway, so every OLT would look like the same source and the brute-force
detectors would merge distinct attacks into one — the exact bug
`packages/security/src/source-ip.ts` was written to prevent. Measured on this
repository's Docker (29.9.2): with a user-defined network, as compose uses,
Docker does start a `docker-proxy` for the published UDP port.

With the host network the kernel delivers the datagram with the real source
address. The price is that the worker reaches Postgres and Redis through the
ports the host publishes instead of through the compose network, and that its
health server must stay on the loopback (`WORKER_HOST=127.0.0.1`) so it does
not listen on every public interface of the server.

Check it on a real deployment:

```bash
pnpm verify:syslog-source-ip
```

The script sends a syslog datagram whose body carries **no IP literal** — the
path that depends on the UDP source address — and then reads the stored event
back. It exits non-zero when the recorded source is not the address the
datagram was sent from.

## The spool lives on a volume

The receiver writes every datagram to a durable spool on disk before it
enqueues the drain job. If the spool lived in the container's filesystem, a
restart would delete exactly the events that were buffered but not yet written
to Postgres. The worker mounts `spool_data` and points `EVENT_SPOOL_DIR` at
it.

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

The extraction is phased, and each phase moves one thing. Today:

- **The recurring loops** (polling, firmware audit, FEC collection) already run
  in the worker. Under `BACKEND_MODE=worker` the web does not start them; it
  marks them as *not expected* in its own health registry so `/api/health`
  stays honest about what this process is responsible for.
- **The syslog receiver** already runs in the worker. It binds the UDP port,
  so the two processes could never bind it at the same time: the kernel
  hands each datagram to one socket and the other would wait forever for
  messages that never arrive.
- **The SNMP receiver** runs in the worker too, for the same reason, and the
  web no longer drains the spool in process: the worker drains it through
  the queue, and two drainers would advance the same offset.

Until the extraction is complete (phase 6 of `odd/tasks/backend-extraction.md`),
`apps/web/instrumentation.ts` still starts the receivers when
`BACKEND_MODE` is `embedded`. That is the rollback path, and it is removed
only after the worker has run green in staging.
