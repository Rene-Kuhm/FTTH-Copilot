/**
 * Verifies that the syslog receiver attributes an event to the real source
 * IP of the datagram.
 *
 * Why this exists: the receiver attributes a syslog event to the IP found in
 * the message body, and falls back to the UDP source address when the body
 * has none. Docker's userland proxy for UDP rewrites that source address to
 * the bridge gateway, so every OLT would look like the same source and the
 * brute-force detectors would merge distinct attacks into one — the exact
 * bug `packages/security/src/source-ip.ts` was written to prevent.
 *
 * The check sends a datagram whose body carries NO IP literal on purpose:
 * that is the path that depends on the UDP source address. It then reads the
 * stored event back and compares the recorded source with the address this
 * process actually sent from.
 *
 * Usage:
 *   pnpm verify:syslog-source-ip
 *
 * Environment:
 *   SYSLOG_VERIFY_HOST      default 127.0.0.1
 *   SYSLOG_VERIFY_PORT      default 5514
 *   SYSLOG_VERIFY_TIMEOUT   default 30000 (ms)
 *   DATABASE_URL            required
 */
import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';
import { prisma } from '@ftth-copilot/db';

const HOST = process.env['SYSLOG_VERIFY_HOST'] ?? '127.0.0.1';
const PORT = Number(process.env['SYSLOG_VERIFY_PORT'] ?? 5514);
const TIMEOUT_MS = Number(process.env['SYSLOG_VERIFY_TIMEOUT'] ?? 30_000);

const MARKER = `verify-source-ip-${randomUUID()}`;

/**
 * RFC 3164 timestamp: "Mmm dd HH:MM:SS".
 *
 * The receiver's parser drops a line whose timestamp does not match, and it
 * drops it silently — the datagram would never reach the spool and the
 * check would fail for the wrong reason.
 */
function rfc3164Timestamp(now: Date): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${months[now.getUTCMonth()]} ${pad(now.getUTCDate())} ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`
  );
}

async function main(): Promise<void> {
  // RFC 3164: <PRI>TIMESTAMP HOSTNAME TAG: MESSAGE. No IP literal in the
  // message body: the attribution must come from the UDP source address.
  const datagram = `<134>${rfc3164Timestamp(new Date())} probe-host probe: ${MARKER}`;

  const sender = dgram.createSocket('udp4');
  // The socket is connected first on purpose: an unbound socket reports
  // 0.0.0.0, and the address the kernel picks for the outgoing datagram is
  // only known once the socket has a destination.
  const sentFrom = await new Promise<string>((resolve, reject) => {
    sender.on('error', reject);
    sender.connect(PORT, HOST, () => {
      const address = sender.address();
      const source = typeof address === 'object' && address !== null ? address.address : 'unknown';
      sender.send(Buffer.from(datagram), (err) => {
        if (err) reject(err);
      });
      resolve(source);
    });
  });

  console.log(`[verify] datagram sent to ${HOST}:${PORT} from ${sentFrom}`);
  console.log(`[verify] marker: ${MARKER}`);

  const deadline = Date.now() + TIMEOUT_MS;
  let recorded: string | null = null;

  while (Date.now() < deadline) {
    const event = await prisma.deviceEvent.findFirst({
      where: { message: { contains: MARKER } },
      orderBy: { createdAt: 'desc' },
    });
    if (event) {
      recorded = event.sourceIp;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  sender.close();

  if (recorded === null) {
    console.error(
      `[verify] FAILED: no event with the marker ${MARKER} appeared within ${TIMEOUT_MS}ms.`,
    );
    console.error('[verify] Is the receiver running and is SYSLOG_TENANT_ID set?');
    process.exit(2);
  }

  console.log(`[verify] the event was stored with sourceIp=${recorded}`);

  if (recorded !== sentFrom) {
    console.error(
      `[verify] FAILED: the event was attributed to ${recorded} but it was sent from ${sentFrom}.`,
    );
    console.error(
      '[verify] The network between the sender and the receiver rewrote the source address.',
    );
    console.error(
      '[verify] With Docker, run the worker with network_mode: host — the userland proxy for UDP rewrites it to the bridge gateway.',
    );
    process.exit(1);
  }

  console.log(`[verify] OK: the source IP survived the network (${recorded}).`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('[verify] failed:', error);
  process.exit(3);
});
