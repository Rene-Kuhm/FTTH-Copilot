# `@ftth-copilot/worker`

The background worker of FTTH-Copilot: a long-running Node 22 process that
consumes the durable job queue (BullMQ + Redis) and exposes its own health and
metrics endpoints.

The operational contract (topology, deploy, rollback) lives in
[`docs/worker.md`](../../docs/worker.md); the design and the task breakdown
live in [`odd/tasks/backend-extraction.md`](../../odd/tasks/backend-extraction.md).

## What it does today

This package is the **skeleton** of the worker (task T4): the process is
deployable and observable, but it does not execute any job yet. The handler
registry ([`src/registry.ts`](src/registry.ts)) is empty on purpose — Phase 3+
registers the real work (polling, firmware audit, FEC collection, syslog/SNMP
ingestion, event drainer) one job at a time.

The worker owns **no domain logic**: it imports the packages that already have
it and only translates a queued job into a call to them.

## Running it

```bash
pnpm --filter @ftth-copilot/worker dev     # watch mode
pnpm --filter @ftth-copilot/worker start   # production entrypoint
```

`start` runs `node --import tsx src/index.ts`: the workspace packages ship
TypeScript source (there is no compiled `dist/`), so `tsx` runs the sources
directly.

## Environment

| Variable            | Default                  | Meaning                                              |
| ------------------- | ------------------------ | ---------------------------------------------------- |
| `REDIS_URL`         | `redis://127.0.0.1:6379` | Redis instance that holds the queue.                  |
| `WORKER_PORT`       | `8081`                   | Port of the health/metrics server.                    |
| `WORKER_HOST`       | `0.0.0.0`                | Interface the health/metrics server binds to.         |
| `WORKER_CONCURRENCY`| `1`                      | Jobs of a queue that run at the same time.            |

### Real-time events (off by default)

The worker also owns the SmartOLT event stream: one SSE loop per `connected`
SmartOLT connection. It is behind a flag, so a deployment that does not ask for
it opens no socket and its health looks exactly as before. The samples it
receives are persisted through the same path the scheduled poll uses
(`persistSamples`), and the ONUs an event flags as degraded go first in the next
FEC sweep.

| Variable                                | Default | Meaning                                                        |
| --------------------------------------- | ------- | -------------------------------------------------------------- |
| `SMARTOLT_EVENTS_ENABLED`               | `false` | Turns the stream on. Anything but `true` keeps it off.          |
| `SMARTOLT_EVENT_TYPES`                  | all     | Comma-separated event types to request.                        |
| `SMARTOLT_EVENT_LIVENESS_MS`            | `120000`| No frame for this long means the loop is hung.                 |
| `SMARTOLT_EVENT_MAX_STREAMS`            | `15`    | Open streams per account (the provider's limit).               |
| `SMARTOLT_EVENT_STREAM_ENDPOINT_PER_HOUR` | `60`  | URL requests per hour and account.                             |
| `SMARTOLT_EVENT_BACKOFF_INITIAL_MS`     | `1000`  | First wait after a stream failure.                             |
| `SMARTOLT_EVENT_BACKOFF_MAX_MS`         | `60000` | Cap of the wait between reconnects.                            |
| `FEC_RATE_LIMIT_PER_HOUR`               | `600`   | FEC sweep budget (leaves 400 of the account's 1,000 for the rest). |

## Endpoints

| Endpoint   | Purpose                                                                     |
| ---------- | --------------------------------------------------------------------------- |
| `/healthz` | JSON: uptime, consumed queues, Redis readiness and the overall status.      |
| `/metrics` | Prometheus text exposition (`text/plain; version=0.0.4; charset=utf-8`).     |

`/healthz` answers **even when Redis is unreachable** — the status becomes
`degraded` instead of failing. A worker that cannot be seen is worse than no
worker, because the failure would be silent.

## Tests

```bash
pnpm --filter @ftth-copilot/worker test
```

The suite is hermetic: it needs no Redis. The queue consumption itself is
covered by the integration suite of `@ftth-copilot/jobs`.

### Stress and soak

Run the load tests on a host with Node 22+, a generated Prisma client
(from `pnpm install`), `redis-server` on `PATH`, and permission to bind TCP
and UDP on loopback. The targets start a disposable Redis on a temporary
loopback port. The workspace dev dependency on `@ftth-copilot/monitoring`
reuses its binary SNMP test sender. Device events and SNMP evidence go to
synthetic sinks in the test process.

```sh
pnpm --filter @ftth-copilot/worker run test:stress
pnpm --filter @ftth-copilot/worker run test:soak
SOAK_SECONDS=14400 pnpm --filter @ftth-copilot/worker run test:soak
```

- **Stress** first fills a disk spool with 10,000 attempts against a 512 KiB
  threshold. It checks refusal counts, transient backoff, recovery and
  event quarantine. Then it runs the real worker consumers with a simulated
  store outage until a probe job exhausts three attempts. It pauses the
  consumer, sends twice the configured UDP rate limit, checks queue depth
  and spool backlog, then resumes and checks both tenants' counts and the
  spool dead-letter. The report distinguishes the syslog rate-limit counter,
  SNMP datagrams that did not reach the sink, and failed BullMQ jobs.
- **Soak** sends 25 events per protocol per cycle, targeting one cycle per
  second. It checks delivery per tenant and an empty backlog before each
  resource sample. The test trims completed jobs after each cycle so queue
  history does not accumulate in Redis. It samples Node's post-GC heap,
  RSS and active resources after three warm-up cycles and at steady-state
  checkpoints. The final sample is compared with the warm-up baseline.
  Redis RSS and PostgreSQL behavior are outside this measurement.

`SOAK_SECONDS` defaults to 120 and accepts 10–86,400.
`SOAK_EVENTS_PER_SECOND` sets the per-protocol batch size (1–1,000).
For the final-minus-baseline checks, `SOAK_HEAP_GROWTH_MIB`,
`SOAK_RSS_GROWTH_MIB` and `SOAK_HANDLE_GROWTH` default to 24, 96 and 2.
Each run prints JSON samples and counters.

The disk-only targets run without sockets or a generated Prisma client.
The disk-only soak defaults to 100 events per cycle and honors the same
soak variables.

```sh
pnpm --filter @ftth-copilot/worker run test:stress:spool
pnpm --filter @ftth-copilot/worker run test:soak:spool
```

The lab sets `SYSLOG_BIND_ADDRESS=127.0.0.1` and
`SNMP_BIND_ADDRESS=127.0.0.1`. Syslog defaults to `0.0.0.0` when
`SYSLOG_BIND_ADDRESS` is unset.
