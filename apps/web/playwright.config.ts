import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3001);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Load auth state from globalSetup (sets __test_bypass cookie)
    storageState: "./e2e/.auth.json",
    // Block the PWA service worker so it doesn't intercept /api/* requests
    // with its NetworkFirst strategy. Without this, mocks via page.route()
    // are short-circuited by the SW cache and tests flake.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: `npx next start -p ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...(process.env as Record<string, string>),
      OIDC_ALLOW_INSECURE_LOOPBACK_ISSUER:
        process.env.OIDC_ALLOW_INSECURE_LOOPBACK_ISSUER ?? "true",
    },
  },
});
