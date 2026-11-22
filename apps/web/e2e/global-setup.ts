import { chromium, type FullConfig } from "@playwright/test";
import { prisma } from "@ftth-copilot/db";
import * as path from "path";
import { fileURLToPath } from "url";

import { clearAuthQuotaBuckets } from "./reset-rate-limits";

/**
 * Global setup for E2E tests.
 * Creates a storage state file with:
 * - __test_bypass cookie (skips auth middleware)
 * - ftth_csrf cookie (valid CSRF token for mutations)
 * Playwright will load this storage state for all tests.
 *
 * Also clears the auth quota buckets so repeated runs are idempotent.
 */
export default async function globalSetup(_config: FullConfig) {
  const cleared = await clearAuthQuotaBuckets(prisma.authRateLimit);
  if (cleared > 0) {
    console.log(`[e2e] cleared ${cleared} auth quota bucket(s)`);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();

  // Generate a CSRF token using a simple random hex string
  // (Playwright doesn't have access to node:crypto)
  const generateHex = (length: number): string => {
    const chars = "0123456789abcdef";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  };
  const csrfToken = generateHex(64);

  // Add the test bypass cookie
  await context.addCookies([
    {
      name: "__test_bypass",
      value: "true",
      domain: "localhost",
      path: "/",
    },
    {
      name: "ftth_csrf",
      value: csrfToken,
      domain: "localhost",
      path: "/",
    },
  ]);

  // Save storage state to a file (ESM compatible)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const storageStatePath = path.join(__dirname, ".auth.json");
  await context.storageState({ path: storageStatePath });

  await context.close();
  await browser.close();
}
