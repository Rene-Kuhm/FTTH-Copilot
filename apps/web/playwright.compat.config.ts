import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
import baseConfig from "./playwright.config";

const browsers = ["chromium", "firefox", "webkit"] as const;
const viewports = [
  { name: "mobile", viewport: { width: 390, height: 844 }, hasTouch: true },
  { name: "tablet", viewport: { width: 768, height: 1024 }, hasTouch: true },
  { name: "desktop", viewport: { width: 1440, height: 900 }, hasTouch: false },
];

const port = 3011;

// The default suite seeds these cookies from globalSetup, which also clears the
// auth quota buckets in PostgreSQL. The matrix mocks every API, so it seeds the
// same cookies inline and needs neither a browser launch nor a database.
const testCookies = [
  { name: "__test_bypass", value: "true" },
  { name: "ftth_csrf", value: randomBytes(32).toString("hex") },
].map((cookie) => ({
  ...cookie,
  domain: "localhost",
  path: "/",
  expires: -1,
  httpOnly: false,
  secure: false,
  sameSite: "Lax" as const,
}));

export default defineConfig({
  ...baseConfig,
  globalSetup: undefined,
  // The default suite exercises real HTTP sessions and identity headers once.
  // Login and signup UI, protected-route redirects and CSRF are covered here.
  testIgnore: ["**/auth-real.spec.ts", "**/middleware-auth.spec.ts"],
  use: {
    ...baseConfig.use,
    baseURL: `http://localhost:${port}`,
    storageState: { cookies: testCookies, origins: [] },
  },
  projects: browsers.flatMap((browserName) =>
    viewports.map(({ name, viewport, hasTouch }) => ({
      name: `${browserName}-${name}`,
      use: { browserName, viewport, hasTouch },
    })),
  ),
  webServer: {
    ...baseConfig.webServer,
    command: `pnpm exec next start --hostname localhost --port ${port}`,
    port,
    reuseExistingServer: false,
  },
});
