import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { it, vi } from 'vitest';
import { __closeSpoolForTests, eventIngestStats, type DeviceEventPayload } from '@ftth-copilot/ingest';
import {
  JOB_NAMES, QUEUE_NAMES, createJobQueue, enqueueJob, redisConnectionOptions, type QueueDepth,
} from '@ftth-copilot/jobs';
import { sendSnmpTestTrap } from '@ftth-copilot/monitoring';
import type { IngestEventInput } from '@ftth-copilot/soc';
import { startWorkerSnmpReceiver } from '../../src/snmp';
import { startWorkerSyslogReceiver } from '../../src/syslog';
import { bootWorkers } from '../../src/workers';
import { runSoak, setting, soakDurationMs } from './soak';

const LOOPBACK = '127.0.0.1';
const SYSLOG_TENANT = 'load-syslog-tenant';
const SNMP_TENANT = 'load-snmp-tenant';
const COMMUNITY = 'synthetic-load';
const POISON = 'fixture-poison';

const sink = vi.hoisted(() => ({
  unavailable: false,
  syslog: 0,
  snmp: 0,
  evidence: 0,
}));

vi.mock('@ftth-copilot/soc', async (importOriginal) => ({
  ...await importOriginal<typeof import('@ftth-copilot/soc')>(),
  runSecurityDetection: async () => { throw new Error('Unexpected detection pass in the load test'); },
  ingestEvents: async (rows: IngestEventInput[]) => {
    if (sink.unavailable) throw Object.assign(new Error('synthetic store outage'), { code: 'P1001' });
    for (const row of rows) {
      assert(row.ingestId);
      assert(row.tenantId === SYSLOG_TENANT || row.tenantId === SNMP_TENANT);
      assert.equal(row.deviceId === 'load-olt', row.tenantId === SNMP_TENANT);
      if (row.message.includes(POISON)) {
        throw Object.assign(new Error('synthetic foreign key violation'), { code: 'P2003' });
      }
    }
    for (const row of rows) {
      if (row.tenantId === SYSLOG_TENANT) sink.syslog++;
      else sink.snmp++;
    }
    return rows.length;
  },
}));

vi.mock('@ftth-copilot/ingest', async (importOriginal) => ({
  ...await importOriginal<typeof import('@ftth-copilot/ingest')>(),
  storeEvidence: async (tenantId: string) => {
    assert.equal(tenantId, SNMP_TENANT);
    sink.evidence++;
  },
}));

async function waitFor(label: string, ready: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 10_000;
  do {
    if (await ready()) return;
    await delay(20);
  } while (performance.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
}

async function freeUdpPort(): Promise<number> {
  const socket = dgram.createSocket('udp4');
  try {
    socket.bind(0, LOOPBACK);
    await once(socket, 'listening');
    return socket.address().port;
  } finally {
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }
}

async function freeTcpPort(): Promise<number> {
  const server = createServer().listen(0, LOOPBACK);
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function withLab(rateLimit: number, exercise: (lab: Lab) => Promise<void>): Promise<void> {
  const syslogPort = await freeUdpPort();
  let snmpPort = await freeUdpPort();
  while (snmpPort === syslogPort) snmpPort = await freeUdpPort();
  const redisPort = await freeTcpPort();
  const dir = mkdtempSync(join(tmpdir(), 'ftth-worker-load-'));
  const cleanup: Array<() => void | Promise<void>> = [];

  try {
    // A private Redis with no disk persistence. The suite never uses a configured Redis URL.
    const redis = spawn('redis-server', [
      '--bind', LOOPBACK, '--port', String(redisPort), '--save', '', '--appendonly', 'no', '--dir', dir,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let redisLog = '';
    let redisError: Error | undefined;
    redis.on('error', (error) => { redisError = error; });
    redis.stdout.on('data', (chunk: Buffer) => { redisLog = (redisLog + chunk.toString()).slice(-4096); });
    redis.stderr.on('data', (chunk: Buffer) => { redisLog = (redisLog + chunk.toString()).slice(-4096); });
    const redisClosed = new Promise<void>((resolve) => redis.once('close', () => resolve()));
    cleanup.push(async () => {
      if (!redis.pid) return;
      redis.kill('SIGTERM');
      const force = setTimeout(() => redis.kill('SIGKILL'), 2000);
      try { await redisClosed; } finally { clearTimeout(force); }
    });
    await waitFor('private Redis to start', () => {
      if (redisError) throw redisError;
      if (redis.exitCode !== null || redis.signalCode !== null) {
        throw new Error(`Private Redis exited during startup: ${redisLog}`);
      }
      return redisLog.includes('Ready to accept connections');
    });

    const env = { REDIS_URL: `redis://${LOOPBACK}:${redisPort}` };
    const settings = {
      EVENT_SPOOL_DIR: dir,
      SYSLOG_RECEIVER_ENABLED: 'true',
      SYSLOG_TENANT_ID: SYSLOG_TENANT,
      SYSLOG_BIND_ADDRESS: LOOPBACK,
      SYSLOG_UDP_PORT: String(syslogPort),
      SYSLOG_MAX_EVENTS_PER_MINUTE: String(rateLimit),
      SYSLOG_MAX_MESSAGE_LENGTH: '2000',
      SYSLOG_DETECTION_INTERVAL_MS: '2147483647',
      SNMP_RECEIVER_ENABLED: 'true',
      SNMP_TENANT_ID: SNMP_TENANT,
      SNMP_UDP_PORT: String(snmpPort),
      SNMP_BIND_ADDRESS: LOOPBACK,
      SNMP_DISABLE_AUTH: 'false',
      SNMP_MAX_PAYLOAD_BYTES: '2048',
      SNMP_MAX_EVENTS_PER_MINUTE: String(rateLimit),
      SNMP_DEDUP_WINDOW_MS: '5000',
      SNMP_SENDER_REGISTRY_JSON: JSON.stringify([{
        senderIp: LOOPBACK, tenantId: SNMP_TENANT, connectionId: 'load-snmp-connection',
        oltId: 'load-olt', vendor: 'Huawei', community: COMMUNITY,
      }]),
    };
    cleanup.push(() => { vi.unstubAllEnvs(); }, __closeSpoolForTests);
    for (const [key, value] of Object.entries(settings)) vi.stubEnv(key, value);

    const queue = createJobQueue('ingest', redisConnectionOptions(env));
    let queueError: Error | undefined;
    queue.on('error', (error) => { queueError = error; });
    cleanup.push(() => queue.close());
    const fleet = bootWorkers({ env, onError: (_, error) => { queueError = error; } });
    cleanup.push(() => fleet.close());
    const syslog = startWorkerSyslogReceiver({ env: { ...env, SYSLOG_TENANT_ID: SYSLOG_TENANT } });
    cleanup.push(() => syslog.stop());
    const snmp = startWorkerSnmpReceiver({ env: { ...env, SNMP_TENANT_ID: SNMP_TENANT } });
    cleanup.push(() => snmp.stop());

    const client = dgram.createSocket('udp4');
    cleanup.push(() => new Promise<void>((resolve) => client.close(() => resolve())));
    client.bind(0, LOOPBACK);
    await once(client, 'listening');
    await waitFor('worker fleet and UDP listeners', () => {
      if (queueError) throw queueError;
      const health = fleet.runtime.ingest;
      return fleet.runtime.redisReady && health?.syslogBound === true && health.snmpBound === true;
    });

    let sequence = 0;
    const sendSyslog = (message: string) => new Promise<void>((resolve, reject) => {
      client.send(Buffer.from(`<13>Jan  1 00:00:00 fixture router: ${message} from 192.0.2.47`),
        syslogPort, LOOPBACK, (error) => error ? reject(error) : resolve());
    });
    const sendSnmp = () => sendSnmpTestTrap({
      port: snmpPort, host: LOOPBACK, version: 'v2c', community: COMMUNITY,
      trapOid: '1.3.6.1.6.3.1.1.5.3',
      varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.1.1', value: ++sequence }],
    });
    const depth = async () => {
      if (queueError) throw queueError;
      const snapshot = await fleet.runtime.queueDepth?.();
      const result = snapshot?.depths.get(QUEUE_NAMES.ingest);
      assert(result, 'Ingest queue depth is unavailable');
      return result;
    };
    Object.assign(sink, { unavailable: false, syslog: 0, snmp: 0, evidence: 0 });
    const initialRateLimited = eventIngestStats().rateLimited;
    await exercise({
      queue, depth, sendSyslog, sendSnmp, dir, fleet,
      rateLimited: () => eventIngestStats().rateLimited - initialRateLimited,
    });
  } finally {
    const cleanupErrors: unknown[] = [];
    for (const close of cleanup.reverse()) {
      try { await close(); } catch (error) { cleanupErrors.push(error); }
    }
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(cleanupErrors, [], 'Load lab cleanup failed');
  }
}

type Lab = {
  queue: ReturnType<typeof createJobQueue<'ingest'>>;
  depth: () => Promise<QueueDepth>;
  sendSyslog: (message: string) => Promise<void>;
  sendSnmp: () => Promise<void>;
  rateLimited: () => number;
  dir: string;
  fleet: ReturnType<typeof bootWorkers>;
};

it('stress retains backlog, retries jobs and isolates bad records under UDP overload', async () => {
  const rate = 128;
  await withLab(rate, async ({ queue, depth, sendSyslog, sendSnmp, rateLimited, dir, fleet }) => {
    const started = performance.now();
    sink.unavailable = true;
    await sendSyslog('before-outage');
    await waitFor('receiver notification to retry', async () => (await depth()).delayed === 1);
    const [delayed] = await queue.getJobs(['delayed']);
    assert(delayed);

    const probe = await enqueueJob(queue, JOB_NAMES.ingestDrain, { source: 'syslog', tenantId: SYSLOG_TENANT }, {
      jobId: 'load-store-outage', attempts: 3, backoff: { type: 'fixed', delay: 25 }, removeOnFail: false,
    });
    await waitFor('test job to reach the failed set', async () => (await depth()).failed === 1);
    assert.equal((await queue.getJob(probe.id ?? ''))?.attemptsMade, 3);
    assert.equal(eventIngestStats().backlog, 1);
    assert.equal(eventIngestStats().deadLettered, 0);
    assert.equal(fleet.runtime.counters.get(QUEUE_NAMES.ingest)?.retried, 3);

    sink.unavailable = false;
    await delayed.promote();
    await waitFor('recovered notification', async () => (await depth()).completed === 1);
    assert.equal(sink.syslog, 1);

    const consumer = fleet.workers.find((worker) => worker.name === QUEUE_NAMES.ingest);
    assert(consumer);
    await consumer.pause();
    for (let i = 0; i < 2 * rate; i++) {
      await sendSyslog(i === 0 ? POISON : `burst-${i}`);
      await sendSnmp();
    }
    await waitFor('paused queue and syslog rate limit', async () =>
      (await depth()).waiting === 2 * rate - 1 && rateLimited() === rate + 1);
    const saturated = await depth();
    assert.equal(eventIngestStats().backlog, 2 * rate - 1);
    assert.equal(sink.evidence, rate);
    await consumer.resume();
    await waitFor('overload drain to finish', async () => (await depth()).completed === 2 * rate);
    assert.equal(eventIngestStats().backlog, 0);
    assert.equal(eventIngestStats().deadLettered, 1);
    assert.equal(sink.syslog, rate - 1);
    assert.equal(sink.snmp, rate);
    const record: { payload: DeviceEventPayload } = JSON.parse(readFileSync(join(dir, 'events.dlq.jsonl'), 'utf8').trim());
    assert.equal(record.payload.tenantId, SYSLOG_TENANT);
    assert(record.payload.message.includes(POISON));
    console.log(JSON.stringify({
      label: 'worker-stress', syslogSent: 2 * rate + 1, syslogRateLimited: rateLimited(),
      snmpSent: 2 * rate, snmpNotAdmitted: 2 * rate - sink.snmp,
      evidence: sink.evidence, saturated, final: await depth(), spool: eventIngestStats(),
      syslogStored: sink.syslog, snmpStored: sink.snmp, elapsedMs: performance.now() - started,
    }));
  });
});

it('soak keeps draining both tenants with bounded Node resource growth', async () => {
  const perProtocol = setting('SOAK_EVENTS_PER_SECOND', 25, 1, 1000);
  await withLab(65 * perProtocol, async ({ queue, depth, sendSyslog, sendSnmp }) => {
    let sent = 0;
    await runSoak('worker-soak', async () => {
      for (let i = 0; i < perProtocol; i++) {
        await sendSyslog(`soak-${sent + i}`);
        await sendSnmp();
      }
      sent += perProtocol;
      await waitFor('soak cycle to drain', async () => (await depth()).completed === 2 * perProtocol);
      assert.equal(sink.syslog, sent);
      assert.equal(sink.snmp, sent);
      assert.equal(sink.evidence, sent);
      assert.equal(eventIngestStats().backlog, 0);
      assert.equal((await depth()).failed, 0);
      // Put a fixed bound on the test's Redis history during multi-hour Node measurements.
      assert.equal((await queue.clean(0, 2 * perProtocol, 'completed')).length, 2 * perProtocol);
    });
    console.log(JSON.stringify({ label: 'worker-soak', sentPerProtocol: sent, ...sink, spool: eventIngestStats() }));
  });
}, soakDurationMs() + 60_000);
