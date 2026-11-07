/**
 * Smoke test of the virtual test bench (`pnpm lab:check`).
 *
 * Proves, with one line per check and a non-zero exit code on any failure:
 *
 *   1. BBSim's REST API lists the simulated OLT, its PON ports and its ONUs,
 *      and the OpenOLT gRPC endpoint accepts a TCP connection.
 *   2. Every downloaded LibreNMS capture is served by snmpsim under its own
 *      community and returns **the value the capture recorded** for sysDescr.
 *   3. The MikroTik CHR answers its REST API with the lab credentials and its
 *      SNMP agent returns a RouterOS sysDescr.
 *
 * It talks to the loopback ports `docker-compose.lab.yml` publishes, so it also
 * proves those ports are reachable from the host.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { formatCheckResult, errorDetail, summarize, type CheckResult } from './lib/check-report.ts';
import {
  CAPTURES,
  CAPTURES_DIRECTORY,
  communityFor,
  type CaptureEntry,
} from './lib/captures.ts';
import { bbsimRestUrl, labConfig, type LabConfig } from './lib/lab-config.ts';
import { SYS_DESCR_OID, parseSysDescr } from './lib/snmprec.ts';
import { snmpGet } from './lib/snmp.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** Captures are local files; the bench never talks to LibreNMS at check time. */
function captureContent(file: string): string | null {
  const location = path.join(REPO_ROOT, CAPTURES_DIRECTORY, file);
  if (!fs.existsSync(location)) return null;
  return fs.readFileSync(location, 'utf8');
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`GET ${url} answered ${response.status} ${response.statusText}`);
  return response.json();
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

async function checkBbsimRest(config: LabConfig): Promise<CheckResult> {
  const name = 'bbsim-rest';
  try {
    const olt = asRecord(await getJson(`${bbsimRestUrl(config)}/v1/olt`), 'the BBSim OLT');
    const serial = olt.SerialNumber;
    const ponPorts = olt.PONPorts;
    if (typeof serial !== 'string' || serial === '') throw new Error('the OLT has no SerialNumber');
    if (!Array.isArray(ponPorts)) throw new Error('the OLT reports no PONPorts');
    if (ponPorts.length !== config.bbsim.ponPorts) {
      throw new Error(`expected ${config.bbsim.ponPorts} PON ports, got ${ponPorts.length}`);
    }
    const technologies = [
      ...new Set(
        ponPorts.map((port) => asRecord(port, 'a PON port').Technology).filter((value) => {
          return typeof value === 'string' && value !== '';
        }),
      ),
    ];
    return {
      name,
      ok: true,
      detail: `OLT ${serial}, ${ponPorts.length} PON ports (${technologies.join(', ') || 'unknown technology'})`,
    };
  } catch (error) {
    return { name, ok: false, detail: errorDetail(error) };
  }
}

async function checkBbsimOnus(config: LabConfig): Promise<CheckResult> {
  const name = 'bbsim-onus';
  try {
    const payload = asRecord(
      await getJson(`${bbsimRestUrl(config)}/v1/olt/onus`),
      'the BBSim ONU listing',
    );
    const items = payload.items;
    if (!Array.isArray(items)) throw new Error('the ONU listing has no items');
    const expected = config.bbsim.ponPorts * config.bbsim.onusPerPon;
    if (items.length !== expected) {
      throw new Error(`expected ${expected} ONUs, got ${items.length}`);
    }
    const serials = new Set<string>();
    const perPort = new Map<number, number>();
    for (const item of items) {
      const onu = asRecord(item, 'an ONU');
      if (typeof onu.SerialNumber !== 'string' || onu.SerialNumber === '') {
        throw new Error('an ONU has no SerialNumber');
      }
      serials.add(onu.SerialNumber);
      const port = onu.PonPortID;
      if (typeof port !== 'number') throw new Error(`ONU ${onu.SerialNumber} has no PonPortID`);
      perPort.set(port, (perPort.get(port) ?? 0) + 1);
    }
    if (serials.size !== items.length) throw new Error('the ONU listing repeats serial numbers');
    for (let port = 0; port < config.bbsim.ponPorts; port += 1) {
      const count = perPort.get(port) ?? 0;
      if (count !== config.bbsim.onusPerPon) {
        throw new Error(`PON port ${port} has ${count} ONUs, expected ${config.bbsim.onusPerPon}`);
      }
    }
    return {
      name,
      ok: true,
      detail: `${items.length} ONUs on ${config.bbsim.ponPorts} PON ports (${serials.size} distinct serials)`,
    };
  } catch (error) {
    return { name, ok: false, detail: errorDetail(error) };
  }
}

function checkTcpPort(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`no answer from ${host}:${port} within 5s`));
    }, 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

async function checkBbsimGrpc(config: LabConfig): Promise<CheckResult> {
  const name = 'bbsim-grpc';
  const { host, ports } = config;
  try {
    await checkTcpPort(host, ports.bbsimGrpc);
    return {
      name,
      ok: true,
      detail: `OpenOLT gRPC accepts TCP connections on ${host}:${ports.bbsimGrpc}`,
    };
  } catch (error) {
    return { name, ok: false, detail: errorDetail(error) };
  }
}

function checkCapturesPresent(): CheckResult {
  const name = 'snmpsim-captures';
  const missing = CAPTURES.filter((entry) => captureContent(entry.file) === null);
  if (missing.length > 0) {
    return {
      name,
      ok: false,
      detail: `${missing.length} of ${CAPTURES.length} captures missing from ${CAPTURES_DIRECTORY}/: ` +
        `${missing.map((entry) => entry.file).join(', ')} (run "pnpm lab:up")`,
    };
  }
  return { name, ok: true, detail: `${CAPTURES.length} captures present in ${CAPTURES_DIRECTORY}/` };
}

async function checkCapture(config: LabConfig, entry: CaptureEntry): Promise<CheckResult> {
  const community = communityFor(entry.file);
  const name = `snmpsim:${community}`;
  try {
    const content = captureContent(entry.file);
    if (content === null) throw new Error(`the capture ${entry.file} is not downloaded`);
    const expected = parseSysDescr(content);
    if (expected === null) throw new Error(`${entry.file} has no usable sysDescr`);
    const served = await snmpGet({
      host: config.host,
      port: config.ports.snmpsim,
      community,
      oid: SYS_DESCR_OID,
      timeoutMs: 3000,
      attempts: 2,
    });
    if (served !== expected) {
      throw new Error(`expected sysDescr "${expected}", snmpsim served "${served}"`);
    }
    return { name, ok: true, detail: `${entry.vendor} ${entry.model}: "${served}"` };
  } catch (error) {
    return { name, ok: false, detail: errorDetail(error) };
  }
}

function chrAuth(config: LabConfig): Record<string, string> {
  const token = Buffer.from(
    `${config.chr.adminUser}:${config.chr.adminPassword}`,
    'utf8',
  ).toString('base64');
  return { Authorization: `Basic ${token}` };
}

async function checkChrRest(config: LabConfig): Promise<CheckResult> {
  const name = 'chr-rest';
  try {
    const resource = asRecord(
      await getJson(`${config.chr.restUrl}/rest/system/resource`, chrAuth(config)),
      'the CHR /rest/system/resource payload',
    );
    const version = resource.version;
    const board = resource['board-name'];
    if (typeof version !== 'string' || version === '') throw new Error('the guest reports no version');
    if (typeof board !== 'string' || board === '') throw new Error('the guest reports no board-name');
    return {
      name,
      ok: true,
      detail: `${board} / RouterOS ${version} (user "${config.chr.adminUser}")`,
    };
  } catch (error) {
    return { name, ok: false, detail: errorDetail(error) };
  }
}

async function checkChrSnmp(config: LabConfig): Promise<CheckResult> {
  const name = 'chr-snmp';
  try {
    const served = await snmpGet({
      host: config.host,
      port: config.ports.chrSnmp,
      community: config.chr.snmpCommunity,
      oid: SYS_DESCR_OID,
      timeoutMs: 3000,
      attempts: 2,
    });
    if (!served.startsWith('RouterOS')) {
      throw new Error(`expected a RouterOS sysDescr, got "${served}"`);
    }
    return { name, ok: true, detail: `"${served}"` };
  } catch (error) {
    return { name, ok: false, detail: errorDetail(error) };
  }
}

async function main(): Promise<void> {
  const config = labConfig();
  console.log(
    `virtual bench at ${config.host}: bbsim rest ${config.ports.bbsimRest}, ` +
      `bbsim grpc ${config.ports.bbsimGrpc}, snmpsim ${config.ports.snmpsim}/udp, ` +
      `chr rest ${config.ports.chrRest}, chr snmp ${config.ports.chrSnmp}/udp\n`,
  );

  const results: CheckResult[] = [
    await checkBbsimRest(config),
    await checkBbsimOnus(config),
    await checkBbsimGrpc(config),
    checkCapturesPresent(),
  ];
  for (const entry of CAPTURES) {
    results.push(await checkCapture(config, entry));
  }
  results.push(await checkChrRest(config), await checkChrSnmp(config));

  for (const result of results) console.log(formatCheckResult(result));
  const summary = summarize(results);
  console.log(`\n${summary.line}`);
  if (summary.exitCode !== 0) {
    console.log('The bench is not ready: run "pnpm lab:up" and check "docker compose -f docker-compose.lab.yml logs".');
  }
  process.exit(summary.exitCode);
}

main().catch((error: unknown) => {
  console.error(`lab-check: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
