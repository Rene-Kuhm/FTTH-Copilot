#!/usr/bin/env tsx
/**
 * Sends a synthetic SOC scenario (burst of SSH auth failures + access + config
 * change) over UDP to the local syslog receiver. Run with the app listening:
 *
 *   SYSLOG_RECEIVER_ENABLED=true SYSLOG_TENANT_ID=local pnpm dev
 *   pnpm test:syslog
 *
 * Optional env:
 *   SYSLOG_HOST=127.0.0.1  SYSLOG_PORT=5514
 */
import dgram from 'node:dgram';
import { buildSocScenarioMessages } from '@ftth-copilot/security';

const HOST = process.env['SYSLOG_HOST'] ?? '127.0.0.1';
const PORT = Number.parseInt(process.env['SYSLOG_PORT'] ?? '5514', 10);

async function main(): Promise<void> {
  const client = dgram.createSocket('udp4');
  await new Promise<void>((resolve, reject) => {
    client.once('error', reject);
    client.bind(0, () => resolve());
  });

  const messages = buildSocScenarioMessages();
  for (const line of messages) {
    await new Promise<void>((resolve, reject) => {
      client.send(Buffer.from(line, 'utf8'), PORT, HOST, (err) =>
        err ? reject(err) : resolve(),
      );
    });
    console.log(`-> ${HOST}:${PORT}  ${line}`);
  }
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
