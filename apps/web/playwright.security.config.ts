import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3011';

export default defineConfig({
  testDir: './security-e2e',
  timeout: 30_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL },
  webServer: {
    command: 'pnpm --filter @ftth-copilot/db db:deploy && pnpm build && pnpm exec next start -H 127.0.0.1 -p 3011',
    url: `${baseURL}/api/health?scope=container`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_DISABLE_PWA: 'true',
      NEXT_OUTPUT_MODE: '',
      DEPLOY_ENV: 'production',
      BACKEND_MODE: 'worker',
      DATABASE_URL: 'postgresql://ftth_audit:audit-synthetic@127.0.0.1:55444/ftth_copilot_security',
      REDIS_URL: 'redis://127.0.0.1:16344/0',
      JWT_SECRET: randomBytes(32).toString('hex'),
      KMS_MASTER_KEY: randomBytes(32).toString('hex'),
      SESSION_COOKIE_SECURE: 'false',
      ENABLE_TEST_AUTH_BYPASS: 'false',
      DEMO_MODE_ENABLED: 'false',
      NMS_ALLOWED_HOSTS: 'nms.synthetic.test',
      NMS_ALLOW_PRIVATE_NETWORKS: 'false',
      NMS_ALLOW_HTTP: 'false',
      AUTH_RATE_LIMIT_MAX: '3',
      AUTH_RATE_LIMIT_WINDOW_MS: '900000',
    },
  },
});
