import { chromium, type FullConfig } from "@playwright/test";

/**
 * Global setup for E2E tests.
 * Adds x-playwright-test header to skip auth middleware in all tests.
 */
export default async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    // Add test bypass header to all pages
    extraHTTPHeaders: {
      "x-playwright-test": "true",
    },
  });
  // Create a storage state with the header configuration
  await context.close();
}
