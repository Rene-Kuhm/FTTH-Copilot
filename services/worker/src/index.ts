/**
 * Entrypoint of the background worker.
 *
 * The process has three responsibilities, in this order:
 *
 *   1. read the environment (Redis URL, health port, concurrency);
 *   2. boot the BullMQ workers and the health/metrics server;
 *   3. shut down cleanly on SIGTERM/SIGINT, so a deploy stops the consumers
 *      instead of killing them mid-job.
 *
 * The worker owns **no domain logic**: it consumes the queues defined by
 * `@ftth-copilot/jobs` and calls the handlers registered in `src/registry.ts`.
 */

import { DEFAULT_HEALTH_HOST, DEFAULT_HEALTH_PORT, startHealthServer } from './health';
import { registeredJobNames } from './registry';
import { registerRecurringSchedules } from './schedules';
import { startWorkerSnmpReceiver } from './snmp';
import { startWorkerSyslogReceiver } from './syslog';
import { DEFAULT_CONCURRENCY, bootWorkers } from './workers';

/** How often the same queue error is logged, in milliseconds. */
const ERROR_LOG_THROTTLE_MS = 30_000;

/** Reads the port of the health server. */
function readPort(env: NodeJS.ProcessEnv): number {
  const raw = env['WORKER_PORT']?.trim();
  if (!raw) return DEFAULT_HEALTH_PORT;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`WORKER_PORT must be a valid TCP port, received "${raw}"`);
  }
  return parsed;
}

/** Reads the interface the health server binds to. */
function readHost(env: NodeJS.ProcessEnv): string {
  return env['WORKER_HOST']?.trim() || DEFAULT_HEALTH_HOST;
}

/** Reads how many jobs of a queue run at the same time. */
function readConcurrency(env: NodeJS.ProcessEnv): number {
  const raw = env['WORKER_CONCURRENCY']?.trim();
  if (!raw) return DEFAULT_CONCURRENCY;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`WORKER_CONCURRENCY must be a positive integer, received "${raw}"`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const env = process.env;
  const port = readPort(env);
  const host = readHost(env);

  // A queue whose Redis is down retries in a tight loop; logging every
  // attempt would bury the real signal, so each queue is throttled.
  const lastErrorAt = new Map<string, number>();

  const fleet = bootWorkers({
    env,
    concurrency: readConcurrency(env),
    onError: (queue, error) => {
      const now = Date.now();
      const last = lastErrorAt.get(queue);
      if (last !== undefined && now - last < ERROR_LOG_THROTTLE_MS) return;
      lastErrorAt.set(queue, now);
      console.error(`[worker] queue "${queue}" error: ${error.message}`);
    },
  });

  const server = await startHealthServer({ runtime: fleet.runtime, port, host });

  const handlers = registeredJobNames();
  console.log(`[worker] health  → http://${host}:${server.port}/healthz`);
  console.log(`[worker] metrics → http://${host}:${server.port}/metrics`);
  console.log(`[worker] consuming queues: ${fleet.runtime.queues.join(', ')}`);
  console.log(
    `[worker] job handlers registered: ${
      handlers.length === 0 ? 'none' : handlers.join(', ')
    }`,
  );

  // The worker owns the syslog socket: it binds it, spools every datagram
  // into the durable spool and enqueues the drain job. The gate is the one
  // of the package (`SYSLOG_RECEIVER_ENABLED=true` and `SYSLOG_TENANT_ID`
  // set), so a worker without them never binds a port.
  //
  // The sockets come up BEFORE the schedules: a UDP socket that binds is
  // what keeps the telemetry alive, and it does not need Redis. A boot that
  // waited for the schedule registration would leave the ports unbound
  // while Redis is down, and the traps would be dropped by the kernel.
  const syslog = startWorkerSyslogReceiver({ env });
  console.log(
    '[worker] syslog receiver started (gate: SYSLOG_RECEIVER_ENABLED=true and SYSLOG_TENANT_ID set)',
  );

  // The worker owns the SNMP socket too: it binds it, spools every trap
  // into the durable spool and enqueues the drain job. The gate is the one
  // of the package (`SNMP_RECEIVER_ENABLED=true`), so a worker without it
  // never binds a port.
  const snmp = startWorkerSnmpReceiver({ env });
  console.log('[worker] SNMP receiver started (gate: SNMP_RECEIVER_ENABLED=true)');

  // The worker owns the schedule of the recurring loops: it registers one
  // recurring schedule per enabled loop and enqueues the first tick
  // immediately. Registering twice is a no-op (the schedule is an upsert keyed
  // by a stable scheduler id), so a restart — or a second replica — never
  // creates two schedules.
  //
  // The registration runs in the background: Redis may be down, and a boot
  // that waited for it would delay the sockets (and the shutdown handler)
  // for as long as the outage lasts. A Redis outage must not take the
  // process down: the health endpoint keeps reporting the degradation, the
  // traps keep landing in the durable spool, and the registration completes
  // on its own when Redis comes back.
  void registerRecurringSchedules({ env })
    .then((schedules) => {
      for (const loop of schedules.registered) {
        console.log(
          `[worker] schedule "${loop.scope}" → ${loop.jobName} every ${loop.everyMs}ms (first tick at ${new Date(loop.firstTickAtMs).toISOString()})`,
        );
      }
      for (const loop of schedules.skipped) {
        console.log(`[worker] schedule "${loop.scope}" not registered: ${loop.reason}`);
      }
    })
    .catch((error: unknown) => {
      console.error('[worker] could not register the recurring schedules:', error);
    });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`[worker] ${signal} received — shutting down`);

    try {
      await server.close();
      await syslog.stop();
      await snmp.stop();
      await fleet.close();
    } catch (error) {
      console.error('[worker] error while shutting down:', error);
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

main().catch((error: unknown) => {
  console.error('[worker] fatal error during startup:', error);
  process.exit(1);
});
