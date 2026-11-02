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

   VictoriaMetrics ◀──── scrape /metrics ──── worker
```

Three properties follow from the split:

- **A web deploy does not stop the monitoring.** The worker has its own
  lifecycle.
- **The web tier scales horizontally.** The loops run once, in the worker.
- **A slow poll no longer competes with HTTP.** Different processes, different
  event loops.

Redis is what makes the split reversible: the jobs that the web enqueues are
in the queue, not in the web's memory, so turning the worker off does not
lose them.

## Environment

| Variable       | Default                  | Meaning                                                                 |
| -------------- | ------------------------ | ----------------------------------------------------------------------- |
| `REDIS_URL`    | `redis://127.0.0.1:6379` | Redis instance that holds the queue. In compose the web reaches Redis by service name (`redis:6379`); the worker, which runs on the host network, uses `127.0.0.1`. |
| `REDIS_PASSWORD` | —                      | Password of the Redis instance. Required in the compose stacks; generate it with `openssl rand -hex 32`. |
| `BACKEND_MODE` | `embedded`               | `embedded` = the web runs the loops (today). `worker` = the worker runs them. |
| `WORKER_PORT`  | `8081`                   | Port of the worker's health and metrics server.                          |
| `WORKER_HOST`  | `0.0.0.0`                | Interface the health server binds to.                                   |
| `WORKER_CONCURRENCY` | `1`                | Jobs of a queue that run at the same time.                              |
| `METRICS_BEARER_TOKEN` | —              | Bearer token that `/metrics` requires. Shared with the app's `/api/metrics`, so the scrape configuration of the whole stack carries one credential. Without it `/metrics` is open, which is only safe on the loopback. |
| `VICTORIAMETRICS_WORKER_SCRAPE_TARGET` | — | `host:port` of the worker as the VictoriaMetrics container sees it. Empty by default: the scrape job is only added when it is set. See [Que VictoriaMetrics raspe al worker](#que-victoriametrics-raspe-al-worker). |
| `INVESTIGATION_PENDING_TTL_MS` | `900000` | Age after which a `pending` investigation attempt is abandoned and expires, so the incident can be investigated again. Must exceed the longest real investigation, retries included. |
| `INVESTIGATION_SWEEP_INTERVAL_MS` | `60000` | How often that sweep runs: in the worker under `worker`, in the web process under `embedded`. |
| `LEARNING_SNAPSHOT_ENABLED` | `false` | Enables the `learning.snapshot` job, which freezes the learning dataset of every tenant. Off by default: it writes rows and nobody consumes them until a later phase of the learning loop. |
| `LEARNING_SNAPSHOT_INTERVAL_MS` | `86400000` | How often the learning snapshot runs (once a day by default). |

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

## The learning snapshot freezes the dataset

The `learning.snapshot` job is the first job of the learning loop
(`odd/tasks/learning-loop.md`, task T0.5). It freezes the dataset of every
tenant: the feedback resolved into labels, the incidents grouped into events
by shared topology, and the temporal split between train and eval — all under
a **hash of the content**.

Freezing is what makes an evaluation reproducible: same content, same window
and same version of the code ⇒ same hash. If the dataset changed, the hash
changed, and it shows.

The worker is the shell of persistence here, as the design says: it reads the
rows of a tenant, hands them to the pure core of `@ftth-copilot/learning` and
stores the artifact in `learning_artifacts`. The artifact is append-only:
freezing the same dataset twice does not create a second row, and a different
dataset coexists with the previous one.

The job is **off by default** (`LEARNING_SNAPSHOT_ENABLED=false`). It writes
rows, costs a query per tenant, and nothing consumes those rows until the
evaluation job of a later phase. Enabling it does not change what an operator
sees.

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

`/metrics` requires the bearer token when `METRICS_BEARER_TOKEN` is set, the
same way the app does on `/api/metrics`. `/healthz` stays open: it is the
container's own health check, and it only exposes coarse operational state.

### What the worker exports

| Metric | Type | What it answers |
| ------ | ---- | --------------- |
| `ftth_copilot_worker_queue_depth{queue}` | gauge | Jobs pending in that queue. The backlog. |
| `ftth_copilot_worker_queue_jobs{queue,state}` | gauge | The same, broken down by state: `waiting`, `active`, `delayed`, `prioritized`, `waiting-children`, `completed`, `failed`. |
| `ftth_copilot_worker_queue_depth_readable{queue}` | gauge | `1` when the depth could be read from Redis, `0` when it could not. **A queue that could not be counted reports a depth of zero; this is the gauge that says the zero is "I do not know" and not "the queue is empty".** |
| `ftth_copilot_worker_job_duration_seconds_bucket{queue,le}` | histogram | How long the jobs take. |
| `ftth_copilot_worker_jobs_completed_total{queue}` | counter | Jobs that finished successfully. |
| `ftth_copilot_worker_jobs_failed_total{queue}` | counter | Failed attempts. |
| `ftth_copilot_worker_jobs_retried_total{queue}` | counter | Failed attempts that BullMQ will retry. Retries hide a failure: the work eventually succeeds, but it is paying for the attempts. |
| `ftth_copilot_worker_ingest_spool_backlog` | gauge | Events received and not stored yet. |
| `ftth_copilot_worker_ingest_dead_lettered_total` | counter | Events moved to the dead-letter file because they could not be stored. Recoverable with `pnpm replay:dead-letter`. |
| `ftth_copilot_worker_ingest_dropped_total` | counter | Events the spool refused because it reached its size limit. **Not recoverable.** |
| `ftth_copilot_worker_ingest_rate_limited_total` | counter | Events discarded by the rate limit of the receiver. **Not recoverable.** |
| `ftth_copilot_worker_redis_ready` | gauge | `1` when every queue's Redis connection is established. |

### The minimum panel

Four queries answer "is the background work keeping up?". They are the same
ones the alerts use, and they run against the VictoriaMetrics API:

```bash
# 1. Is any queue backing up?
curl -sG 'http://localhost:8428/api/v1/query' \
  --data-urlencode 'query=ftth_copilot_worker_queue_depth'

# 2. How slow are the jobs? (p95 over the whole fleet)
curl -sG 'http://localhost:8428/api/v1/query' \
  --data-urlencode 'query=histogram_quantile(0.95, sum by (le) (rate(ftth_copilot_worker_job_duration_seconds_bucket[15m])))'

# 3. Is anything failing and being retried?
curl -sG 'http://localhost:8428/api/v1/query' \
  --data-urlencode 'query=sum(increase(ftth_copilot_worker_jobs_failed_total[15m]))'

# 4. Is telemetry being lost?
curl -sG 'http://localhost:8428/api/v1/query' \
  --data-urlencode 'query=increase(ftth_copilot_worker_ingest_dead_lettered_total[15m])'
```

The alerts that watch these live in
[`docker/victoriametrics-alerts.yml`](../docker/victoriametrics-alerts.yml),
in the group `ftth-copilot-worker`. They stay INACTIVE in a deployment
without a worker: an alert that fires because a component is not deployed is
an alert nobody reads.

The contract between the alerts and the exported names is checked by
`pnpm check:observability`, which runs in CI: an alert on a metric nobody
exports would stay INACTIVE forever, and the operator would believe they had
coverage.

### Que VictoriaMetrics raspe al worker

The scrape configuration of the worker is a second job of the **same** scrape
file: the single-node binary of VictoriaMetrics reads a single
`-promscrape.config` (the last flag wins), so both jobs have to end up in the
same file. `docker/victoriametrics-entrypoint.sh` appends the worker job only
when `VICTORIAMETRICS_WORKER_SCRAPE_TARGET` is set.

The worker runs on the host network, so the target is **not** a compose
service name: it is the address of the host as the VictoriaMetrics container
sees it. There are two things to set, and they go together:

```bash
# 1. The worker has to listen on an address the container can reach.
#    With the host network, 127.0.0.1 is the host's loopback and the
#    container does not reach it.
WORKER_HOST=0.0.0.0

# 2. The scrape target, from the point of view of the VictoriaMetrics
#    container. `host.docker.internal` resolves to the host gateway.
VICTORIAMETRICS_WORKER_SCRAPE_TARGET=host.docker.internal:8081
```

Two caveats, both measured:

- **The host firewall can block it.** A container reaching a port published
  by the host goes through the host's firewall, and a strict one drops it.
  The symptom is `up{job="ftth-copilot-worker"} == 0` while the worker
  answers fine from the host. The alternative is to run the scraper on the
  host network too.
- **Set `METRICS_BEARER_TOKEN` when the worker leaves the loopback.** The
  endpoint is open otherwise, and with `WORKER_HOST=0.0.0.0` open means
  every interface of the server.

The target is opt-in in both compose files on purpose: the worker runs
behind a profile, so a target that is always configured would be a target
that is always down.

## Rollback

The extraction is reversible without a code revert.

### When to roll back

| Signal | Meaning |
| ------ | ------- |
| `FTTHCopilotWorkerRedisUnreachable` | The worker cannot reach Redis. It is alive but not consuming, and the monitoring is stopped without failing loudly. |
| `FTTHCopilotWorkerQueueBacklog` | A queue is not being drained for 15 minutes. The worker does not keep up. |
| `FTTHCopilotWorkerJobsFailing` | The handlers are failing. Check the logs before rolling back: a rollback does not fix a broken handler, it only hides it. |
| `FTTHCopilotWorkerIngestDeadLettered` / `...EventsLost` | Telemetry is being lost. Roll back only after the events are recovered. |

### How to roll back

```bash
# 1. Set BACKEND_MODE=embedded in the environment.
# 2. Stop the worker.
docker compose --profile worker stop worker
# 3. Restart the web app so it picks up the flag.
docker compose restart app
```

The web goes back to running the loops in-process, which is exactly the
behavior it had before the extraction. No data migration is involved: the
queue payload lives in Redis, and the rows the worker would have written are
the same rows the embedded path writes.

**The order matters.** Stop the worker *before* restarting the web with
`BACKEND_MODE=embedded`. The two are mutually exclusive while they overlap:
the web would run its own loops *and* the worker would run its own, so the
NMS would be polled twice and both processes would try to bind the UDP
socket. The second one to try gets nothing, silently.

### Verify the rollback

```bash
# The web owns the loops again.
curl -s http://localhost:3001/api/health | jq '.services'

# The worker is not consuming anything.
docker compose --profile worker logs worker | tail -20
```

The jobs that were in the queue when the worker stopped are **not lost**: they
stay in Redis, and the web's embedded path picks them up when it restarts.
That is the whole point of the durable queue.

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
- **Incident investigations** run in the worker under `BACKEND_MODE=worker`.
  `POST /api/incidents/:id/investigate` claims the attempt under a
  per-incident Postgres advisory lock (so simultaneous requests start one
  attempt), enqueues it on `ftth-investigation` with the job id
  `investigation-<runId>-<versionId>`, and waits for the result in Postgres up
  to the HTTP budget: `201` if it finished, `202` if not. The worker re-checks
  that the incident belongs to the tenant of the payload, skips an attempt
  that is no longer the run's `currentVersionId`, retries only transient
  errors (at most 3 attempts), and otherwise leaves the run `failed`. Under
  `embedded` the web runs the pipeline itself and closes that same promise
  even after answering `202`. Either way an attempt ends `ready` or `failed`,
  or the sweep moves it to `expired`; it is never left `pending` forever.

Until the extraction is complete (phase 6 of `odd/tasks/backend-extraction.md`),
`apps/web/instrumentation.ts` still starts the receivers when
`BACKEND_MODE` is `embedded`. That is the rollback path, and it is removed
only after the worker has run green in staging.
