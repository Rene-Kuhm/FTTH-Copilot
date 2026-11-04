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

Redis is what makes the split safe: the jobs that the web enqueues are in the
queue, not in the web's memory, so a worker that stops does not lose them.

## Environment

| Variable       | Default                  | Meaning                                                                 |
| -------------- | ------------------------ | ----------------------------------------------------------------------- |
| `REDIS_URL`    | `redis://127.0.0.1:6379` | Redis instance that holds the queue. In compose the web reaches Redis by service name (`redis:6379`); the worker, which runs on the host network, uses `127.0.0.1`. |
| `REDIS_PASSWORD` | —                      | Password of the Redis instance. Required in the compose stacks; generate it with `openssl rand -hex 32`. |
| `BACKEND_MODE` | `worker`                 | The worker is the only owner of the background work. There is no `embedded` mode left: a value of `embedded` is rejected at boot. |
| `WORKER_PORT`  | `8081`                   | Port of the worker's health and metrics server.                          |
| `WORKER_HOST`  | `0.0.0.0`                | Interface the health server binds to.                                   |
| `WORKER_CONCURRENCY` | `1`                | Jobs of a queue that run at the same time.                              |
| `METRICS_BEARER_TOKEN` | —              | Bearer token that `/metrics` requires. Shared with the app's `/api/metrics`, so the scrape configuration of the whole stack carries one credential. Without it `/metrics` is open, which is only safe on the loopback. |
| `VICTORIAMETRICS_WORKER_SCRAPE_TARGET` | — | `host:port` of the worker as the VictoriaMetrics container sees it. Empty by default: the scrape job is only added when it is set. See [Que VictoriaMetrics raspe al worker](#que-victoriametrics-raspe-al-worker). |
| `INVESTIGATION_PENDING_TTL_MS` | `900000` | Age after which a `pending` investigation attempt is abandoned and expires, so the incident can be investigated again. Must exceed the longest real investigation, retries included. |
| `INVESTIGATION_SWEEP_INTERVAL_MS` | `60000` | How often the worker sweeps the investigation attempts that were abandoned. |
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

`BACKEND_MODE` is validated by `@ftth-copilot/jobs`
(`assertWorkerBackendMode()`), and the web calls it at boot. The worker does
not read it: the worker *is* the worker. The only value that means something
is `worker`, and an unset variable means the same.

The compose stacks set it explicitly in the app's `environment:`, so a
`.env` left over from before the cut-over cannot put the web back in a mode
that does not exist.

### Why the worker is the only owner

There used to be two paths: `embedded` (the loops inside the web process) and
`worker`. `embedded` was the default because it was the behavior that was
already proven in production, and flipping the default before the worker had
proven itself would have turned a failed extraction into a monitoring outage.

The worker ran green in staging —against a real Postgres, with the web
scaled to two replicas and no duplicated tick— so the in-process path was
removed. What is left is the one path that survives a deploy of the UI, runs
the same loop once no matter how many web replicas there are, and keeps the
UDP sockets in a single process.

`BACKEND_MODE=embedded` is now an error, not a fallback. An environment that
still asks for it is one that was never migrated, and the failure it would
cause —a web serving HTTP while nobody polls anything— is silent. Failing at
boot says it out loud.

## Deploying the worker

The worker is part of the stack: `docker compose up -d` starts it along with
the web, and the compose files set `BACKEND_MODE=worker` on the app so the
two can never disagree.

```bash
docker compose up -d
```

The worker used to sit behind a `--profile worker` so it could not be started
by accident. Now it is the only owner of the background work, so a stack
without it is a stack that does not poll anything: starting it by accident is
not the risk anymore — forgetting it is.

**Every** deployment brings it: the production compose, the staging override,
the demo, and the HTTPS one (`docker-compose.https.yml`, which is standalone —
its own Postgres, its own Redis, its own web and its own worker). The CI
checks it: a compose that raises the web without a worker fails the build, and
so does the PM2 ecosystem without a worker process.

### Without Docker: PM2

The deployment that does not use containers runs the worker as its own PM2
process, next to the web and the tunnel:

```bash
pm2 start ecosystem.config.cjs
```

`ecosystem.config.cjs` declares `ftth-copilot-worker`, which runs
`services/worker/start.sh`: it makes `cd` to the root of the repository and
starts `pnpm --filter @ftth-copilot/worker start`. It reads the same
`apps/web/.env` as the web — same deployment, same database, same queue — and
keeps the health and metrics server on the loopback. `pnpm` has to be in the
PATH of the process PM2 starts: PM2 only forwards its own environment, so the
shell that launched it has to have it.

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

### The state of the loops travels in Redis

The registry of the scheduled loops lives in the memory of the process that
runs them — the worker. The web serves `/api/health`, and it cannot read
that registry from its own memory: it does not even share the copy of the
registry with the instrumentation that starts the loops, because Next.js
bundles each entry point separately. Two processes, two memories: the web
would report an empty list of services while the worker does the work.

So the worker publishes what it knows and the web reads it from there:

| Key                            | What                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ftth:worker:scheduler-health` | JSON: the state of every loop (`services`), the counters of the ingest path (`counters`) and the time of the publication (`publishedAt`).                            |

The worker refreshes it every 20 seconds and the key expires after 60. A
worker that dies leaves no trace behind: the web degrades instead of
reporting a healthy worker that stopped working minutes ago.

The contract lives in `@ftth-copilot/scheduler` (`WORKER_HEALTH_KEY`,
`buildWorkerHealthSnapshot`, `parseWorkerHealthSnapshot`), so both ends
agree on the shape without either of them knowing how the other is
implemented. The parse is strict on purpose: a value that is not a snapshot
is reported as "no snapshot", never as a truth.

```bash
# The state of the loops, as the web reads it.
redis-cli -a "$REDIS_PASSWORD" --no-auth-warning \
  get ftth:worker:scheduler-health | jq .
```

### The warm-up tick after a restart

The schedule of a loop is a grid, and BullMQ does **not** reprogram a grid
that already exists: `upsertJobScheduler` keeps the iteration that is
there. On a cold start the grid is created with `now + 5 s` and its first
job is the warm-up tick, five seconds after the worker comes up. After a
restart there is no cold start — the grid is the one of the first boot —
so the first tick of a loop would be the one the grid had planned, which
for the firmware is 24 hours away.

The worker compares that next run with the clock. When it is more than a
minute away, it forces a warm-up tick of its own, five seconds after the
boot. The id of that job comes from the slot of the grid
(`warmup-<scope>-<slot>`), which is what keeps it single:

- two workers that boot at the same time compute the same id, and BullMQ
  refuses to enqueue a second job with an id that already exists;
- a worker that restarts inside the same slot does not warm the loop
  twice, because the id of that slot is already taken.

The warm-up is a real tick: it samples the NMS like any other. A restart
therefore costs one extra poll, and never two.

### The deadline of a loop

The registry of the health lives in the memory of the process and starts
empty on every boot. A worker that just came up has loops that never
ticked, and "never ticked" read as "dead" would leave the health of the
whole system degraded until the first tick.

The deadline is what tells the two apart. It belongs to the schedule, not
to the process: the worker reads the next run of the grid from BullMQ and
publishes it, with the period of the loop, in the snapshot
(`nextRunAt` and `intervalMs` per service). The worker refreshes it every
30 seconds, because the grid moves on its own — the worker that consumes
the tick may be another replica.

With the deadline, a loop that has not ticked yet is **warming up**: it
is not degraded while its tick is still to come, and it is *hung* when
the tick it was waiting for does not arrive. `/api/health` publishes that
state per service:

| State      | What it means                                                       |
| ---------- | ------------------------------------------------------------------- |
| `ok`       | The loop ticked and its last tick is not old.                       |
| `warming`  | The loop has not ticked yet, and its expected tick is still to come. |
| `error`    | The last tick failed; `lastError` says why.                         |
| `hung`     | The tick that was expected did not arrive.                          |
| `inactive` | The operator did not enable the loop.                               |

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

The in-process path is gone, so the rollback is not a variable anymore: it is
the previous version. The **compose goes back with it** —the previous
version's compose had the worker behind a profile, and that is what keeps
the worker from starting next to a web that runs the loops in-process.

```bash
# 1. Stop the worker. The previous version of the web runs the loops
#    in-process, and the two would poll the NMS twice and both would try to
#    bind the UDP socket. The second one to try gets nothing, silently.
docker compose stop worker

# 2. Deploy the previous version. The checkout brings back its compose too.
git checkout <commit-anterior>
docker compose up -d --build
```

`docker compose up -d --build` without the checkout would rebuild the
*current* tree: it would roll nothing back, and it would start the worker
again, because the worker is no longer behind a profile.

No data migration is involved: the queue payload lives in Redis, and the rows
the worker writes are the same rows the in-process path wrote. The jobs that
were in the queue when the worker stopped are **not lost** either — they stay
in Redis and the previous version picks them up.

### Verify the rollback

```bash
# The web owns the loops again. The `owner` field says `embedded` here: the
# previous version had both modes.
curl -s http://localhost:3001/api/health | jq '.owner, .services'

# The worker is not consuming anything.
docker compose logs worker | tail -20
```

## What is still in the web

The extraction is finished: the worker owns the background work and the web
serves HTTP and the SSE stream. What is left in the web:

- **Nothing that runs in the background.** The web does not import the
  scheduler, nor the receivers, nor the drainer: a web that imported them
  would be one refactor away from running two copies of every loop. The
  instrumentation only marks the loops and the receivers as *not expected* in
  its own health registry, so `/api/health` stays honest about what this
  process is responsible for.
- **The HTTP and the SSE stream**, and the enqueueing of the work that the
  background needs.
- **The incident investigations** are queued, not run: `POST
  /api/incidents/:id/investigate` claims the attempt under a per-incident
  Postgres advisory lock (so simultaneous requests start one attempt),
  enqueues it on `ftth-investigation` with the job id
  `investigation-<runId>-<versionId>`, and waits for the result in Postgres up
  to the HTTP budget: `201` if it finished, `202` if not. The worker re-checks
  that the incident belongs to the tenant of the payload, skips an attempt
  that is no longer the run's `currentVersionId`, retries only transient
  errors (at most 3 attempts), and otherwise leaves the run `failed`. An
  attempt ends `ready` or `failed`, or the worker's sweep moves it to
  `expired`; it is never left `pending` forever.


The extraction is complete. `apps/web/instrumentation.ts` no longer starts
anything: the worker has run green in staging, and the in-process path was
removed with it.
