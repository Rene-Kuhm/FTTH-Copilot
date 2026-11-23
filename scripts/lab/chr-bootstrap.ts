/**
 * Provision the MikroTik CHR of the virtual bench.
 *
 * The stock CHR boots with `admin` and no password and with SNMP disabled, so
 * `pnpm lab:up` runs this right after the containers start and before it waits
 * for their health checks. What it sets, and nothing else:
 *
 *   - a **lab-only** admin password, so the guest is never left with a blank
 *     administrator,
 *   - the SNMP agent with the lab community (read-only, no v3 users),
 *   - a hostname that identifies the guest in logs.
 *
 * The script is idempotent: it authenticates with the configured password when
 * the guest is already provisioned, and only falls back to the blank-password
 * bootstrap when the guest is fresh. Restarting the container is enough to get
 * a fresh guest, because the CHR disk lives inside the container.
 *
 * Usage: `tsx scripts/lab/chr-bootstrap.ts [--timeout=<seconds>]`
 */
import { labConfig, type LabConfig } from './lib/lab-config.ts';
import { snmpGet } from './lib/snmp.ts';
import { SYS_DESCR_OID } from './lib/snmprec.ts';

/** Boot time of the CHR under KVM on a loaded machine. */
const DEFAULT_TIMEOUT_SECONDS = 300;
const POLL_INTERVAL_MS = 3000;
const PASSWORD_APPLY_TIMEOUT_MS = 30_000;

/** RouterOS key/value body used by the REST API. */
type RestBody = Record<string, string>;

interface Credentials {
  readonly user: string;
  readonly password: string;
}

function log(message: string): void {
  console.log(`chr-bootstrap: ${message}`);
}

function parseTimeout(argv: readonly string[]): number {
  for (const argument of argv) {
    const match = /^--timeout=(\d+)$/.exec(argument);
    if (match) return Number(match[1]);
  }
  return DEFAULT_TIMEOUT_SECONDS;
}

/** `Authorization: Basic` header for the guest REST API. */
function basicAuth(credentials: Credentials): string {
  const token = Buffer.from(`${credentials.user}:${credentials.password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RestResult {
  readonly status: number;
  readonly body: unknown;
}

/** One REST call against the guest. */
async function rest(
  url: string,
  credentials: Credentials,
  method: string,
  body?: RestBody,
): Promise<RestResult> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: basicAuth(credentials),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

/**
 * What goes into an error message about a REST failure: the HTTP status only.
 * The body is never echoed: RouterOS can reflect request data in it, and these
 * errors end up in the console.
 */
/** True when RouterOS closed the session on purpose (it does so after a password change). */
function sessionClosed(result: RestResult): boolean {
  if (result.body && typeof result.body === 'object') {
    const message = (result.body as Record<string, unknown>).message;
    return typeof message === 'string' && message.includes('Session closed');
  }
  return false;
}

function restError(result: RestResult): string {
  return `HTTP ${String(Number(result.status))}`;
}

/**
 * Wait for the REST API and authenticate with whichever credential works:
 * the configured lab password (already provisioned guest) or a blank one
 * (fresh guest).
 */
async function waitForRest(config: LabConfig, timeoutSeconds: number): Promise<{
  credentials: Credentials;
  fresh: boolean;
}> {
  const { restUrl, adminUser, adminPassword } = config.chr;
  const configured: Credentials = { user: adminUser, password: adminPassword };
  const blank: Credentials = { user: adminUser, password: '' };
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastError = 'no attempt made';

  while (Date.now() < deadline) {
    try {
      const withPassword = await rest(`${restUrl}/rest/system/resource`, configured, 'GET');
      if (withPassword.status === 200) return { credentials: configured, fresh: false };
      if (withPassword.status === 401) {
        const withBlank = await rest(`${restUrl}/rest/system/resource`, blank, 'GET');
        if (withBlank.status === 200) return { credentials: blank, fresh: true };
        lastError = 'REST rejected both the lab password and a blank one';
      } else {
        lastError = 'REST answered with an unexpected status';
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `the CHR REST API did not come up at ${restUrl} within ${timeoutSeconds}s (${lastError})`,
  );
}

/** The `.id` of the admin user, which RouterOS requires to address the item. */
async function adminUserId(restUrl: string, credentials: Credentials, adminUser: string): Promise<string> {
  const result = await rest(`${restUrl}/rest/user`, credentials, 'GET');
  if (result.status !== 200 || !Array.isArray(result.body)) {
    throw new Error(`cannot list RouterOS users: ${result.status} ${restError(result)}`);
  }
  for (const item of result.body) {
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      if (record.name === adminUser && typeof record['.id'] === 'string') return record['.id'];
    }
  }
  throw new Error(`the guest has no "${adminUser}" user`);
}

async function setAdminPassword(config: LabConfig, credentials: Credentials): Promise<void> {
  const { restUrl, adminUser, adminPassword } = config.chr;
  const id = await adminUserId(restUrl, credentials, adminUser);
  const result = await rest(`${restUrl}/rest/user/${id}`, credentials, 'PATCH', {
    password: adminPassword,
  });
  // RouterOS closes the session on a successful password change and reports it
  // as a 400 with "Session closed"; the value is applied. The caller verifies
  // by authenticating with the new password instead of trusting this status.
  if (result.status !== 200 && !sessionClosed(result)) {
    throw new Error(`cannot set the admin password: ${result.status} ${restError(result)}`);
  }

  // RouterOS applies the new password a moment after closing the session, so
  // an immediate check can still see 401: poll until it authenticates.
  const deadline = Date.now() + PASSWORD_APPLY_TIMEOUT_MS;
  for (;;) {
    const verified = await rest(`${restUrl}/rest/system/resource`, {
      user: adminUser,
      password: adminPassword,
    }, 'GET');
    if (verified.status === 200) break;
    if (Date.now() >= deadline) {
      throw new Error(`the new admin password does not authenticate: ${verified.status}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  log(`admin password set for user "${adminUser}"`);
}

async function enableSnmp(config: LabConfig, credentials: Credentials): Promise<void> {
  const { restUrl, snmpCommunity } = config.chr;
  const enabled = await rest(`${restUrl}/rest/snmp/set`, credentials, 'POST', {
    enabled: 'true',
    contact: 'ftth-lab',
    location: 'ftth-copilot virtual bench',
  });
  if (enabled.status !== 200) {
    throw new Error(`cannot enable SNMP: ${enabled.status} ${restError(enabled)}`);
  }

  const listing = await rest(`${restUrl}/rest/snmp/community`, credentials, 'GET');
  if (listing.status !== 200 || !Array.isArray(listing.body)) {
    throw new Error(`cannot list SNMP communities: ${listing.status} ${restError(listing)}`);
  }
  const entries = listing.body.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
  );
  const target = entries.find((item) => item.name === snmpCommunity) ?? entries[0];
  if (!target || typeof target['.id'] !== 'string') {
    throw new Error('the guest has no SNMP community to configure');
  }
  if (target.name !== snmpCommunity) {
    const renamed = await rest(
      `${restUrl}/rest/snmp/community/${target['.id']}`,
      credentials,
      'PATCH',
      { name: snmpCommunity },
    );
    if (renamed.status !== 200) {
      throw new Error(`cannot rename the SNMP community: ${renamed.status} ${restError(renamed)}`);
    }
  }
  log('SNMP enabled with the lab community');
}

async function verifySnmp(config: LabConfig): Promise<void> {
  const deadline = Date.now() + 60000;
  let lastError = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const description = await snmpGet({
        host: config.host,
        port: config.ports.chrSnmp,
        community: config.chr.snmpCommunity,
        oid: SYS_DESCR_OID,
        timeoutMs: 2000,
        attempts: 1,
      });
      if (description.trim() === '') throw new Error('the agent returned an empty sysDescr');
      log(`SNMP answers on ${config.host}:${config.ports.chrSnmp} (sysDescr: ${description})`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(POLL_INTERVAL_MS);
    }
  }
  throw new Error(
    `the CHR does not answer SNMP on ${config.host}:${config.ports.chrSnmp}: ${lastError}`,
  );
}

async function main(): Promise<void> {
  const config = labConfig();
  const timeoutSeconds = parseTimeout(process.argv.slice(2));

  log(`waiting for ${config.chr.restUrl} (up to ${timeoutSeconds}s)`);
  const { credentials: initial, fresh } = await waitForRest(config, timeoutSeconds);
  log(fresh ? 'fresh guest: provisioning' : 'guest already provisioned: re-applying SNMP settings');

  // A fresh guest answers with a blank password; everything after setting it
  // has to authenticate with the lab password instead.
  const credentials: Credentials = fresh
    ? { user: initial.user, password: config.chr.adminPassword }
    : initial;
  if (fresh) await setAdminPassword(config, initial);
  await enableSnmp(config, credentials);
  await verifySnmp(config);
  log('CHR ready');
}

main().catch((error: unknown) => {
  console.error(`chr-bootstrap: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
