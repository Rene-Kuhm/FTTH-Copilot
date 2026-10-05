import { chromium, type FullConfig } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * Global setup for E2E tests.
 * Creates a storage state file with the test bypass cookie.
 * Playwright will load this storage state for all tests.
 */
export default async function globalSetup(_config: FullConfig) {
  const browser = await chromium.launch();
  const context = await browser.newContext();

  // Add the test bypass cookie
  await context.addCookies([
    {
      name: "__test_bypass",
      value: "true",
      domain: "localhost",
      path: "/",
    },
  ]);

  // Save storage state to a file
  const storageStatePath = path.join(__dirname, ".auth.json");
  await context.storageState({ path: storageStatePath });

  await context.close();
  await browser.close();
}
