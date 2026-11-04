const fs = require('node:fs');
const path = require('node:path');

// Load CLOUDFLARED_TOKEN from the git-ignored root .env file.
// The tunnel token must never be committed to the repository.
function loadEnvValue(name) {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  try {
    const content = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const line = content
      .split('\n')
      .find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).trim();
  } catch {
    // .env missing — fall through
  }
  return undefined;
}

module.exports = {
  apps: [
    {
      name: 'ftth-copilot',
      script: '/bin/bash',
      args: '/home/tecnodespegue/FTTH-Copilot-workdir/FTTH-Copilot/apps/web/start.sh',
      // Load DATABASE_URL, JWT_SECRET, KMS_MASTER_KEY and the NOC/SOC activation
      // flags (METRICS_POLLER_ENABLED, SYSLOG_*) from apps/web/.env. Without this,
      // PM2 only forwards its own `env` block and the .env vars never reach the
      // process — Next.js would still see DATABASE_URL via dotenv, but the
      // instrumented NOC/SOC code reads from process.env at runtime.
      env_file: './apps/web/.env',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ftth-copilot-worker',
      script: '/bin/bash',
      args: '/home/tecnodespegue/FTTH-Copilot-workdir/FTTH-Copilot/services/worker/start.sh',
      // The worker owns the background work: polling, firmware audit, FEC
      // collection, syslog/SNMP reception and the event drainer. The web
      // only serves HTTP, so a deployment without this process is a
      // deployment that polls nothing — and the health does not show it in
      // red, because there are no loops left to expect.
      //
      // It reads the same environment file as the web: it is the same
      // deployment, with the same database and the same queue.
      env_file: './apps/web/.env',
      env: {
        NODE_ENV: 'production',
        // The health and metrics server of the worker stays on the loopback:
        // it is an unauthenticated endpoint unless METRICS_BEARER_TOKEN is
        // set, and on a public server it would listen on every interface.
        // The `env` block wins over `env_file`, so this is the place to
        // change it if something outside the host has to reach it.
        WORKER_HOST: '127.0.0.1',
      },
      restart_delay: 5000,
      max_restarts: 10,
    },
    {
      name: 'cloudflared',
      script: '/home/tecnodespegue/bin/cloudflared',
      // TUNNEL_TOKEN env var is equivalent to `--token <value>`.
      args: 'tunnel --protocol http2 --no-autoupdate run',
      env: {
        TUNNEL_TOKEN: loadEnvValue('CLOUDFLARED_TOKEN'),
      },
      restart_delay: 5000,
      max_restarts: 10,
    },
  ],
};
