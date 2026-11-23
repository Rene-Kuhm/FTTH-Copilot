import { profiles } from './profiles';

async function main() {
  const [target, scenario, extra] = process.argv.slice(2);
  if (extra || (target !== 'api' && target !== 'ingest' && target !== 'spool')
    || (scenario !== 'performance' && scenario !== 'load' && scenario !== 'spike')) {
    throw new Error('Usage: pnpm test:perf <api|ingest|spool> <performance|load|spike>');
  }

  console.log(JSON.stringify({ target, scenario, node: process.version }));
  const pass = target === 'api'
    ? await (await import('./api')).runApi(profiles.api[scenario])
    : await (await import('./ingest'))[target === 'ingest' ? 'runPostgresIngest' : 'runSpool'](
      profiles.ingest[scenario],
    );
  if (!pass) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  // Prisma and fetch errors may contain connection details.
  const message = error instanceof Error ? error.message.split('\n')[0] : '';
  console.error(message || 'Performance target failed; check its local service logs');
  process.exitCode = 1;
});
