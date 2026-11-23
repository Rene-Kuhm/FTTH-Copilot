import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3418);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('E2E_PORT must be an integer from 1 to 65535');
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/a11y/*.spec.ts', '**/visual/*.spec.ts'],
  outputDir: './test-results/a11y-visual',
  updateSnapshots: 'none',
  forbidOnly: !!process.env.CI,
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'es-AR',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `next start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      JWT_SECRET: 'e2e-jwt-secret-for-playwright-only',
      ENABLE_TEST_AUTH_BYPASS: 'true',
    },
    stderr: 'pipe',
  },
});
