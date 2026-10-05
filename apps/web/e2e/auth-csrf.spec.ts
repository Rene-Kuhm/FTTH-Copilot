import { test, expect } from "@playwright/test";

/**
 * E2E coverage for the CSRF gate in `middleware.ts` and the auth redirect.
 *
 * The probe path below has no route handler on purpose. The CSRF check runs in
 * the middleware *before* routing, so probing it isolates the security layer:
 * no database, no upstream API, no auth secret required.
 */
const PROBE = "/api/__csrf-probe__";

test.describe("CSRF protection", () => {
  test("rejects a mutation sent without a CSRF header", async ({ page }) => {
    const response = await page.request.post(PROBE, { data: {} });

    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid CSRF token",
    });
  });

  test("rejects a mutation whose header does not match the cookie", async ({ page }) => {
    const response = await page.request.post(PROBE, {
      data: {},
      headers: { "x-csrf-token": "deadbeef".repeat(8) },
    });

    expect(response.status()).toBe(403);
  });

  test("lets a mutation through when the header matches the cookie", async ({
    page,
    context,
  }) => {
    const csrf = (await context.cookies()).find(
      (cookie) => cookie.name === "ftth_csrf",
    );
    // global-setup seeds this cookie for every test run.
    expect(csrf, "global-setup must seed the ftth_csrf cookie").toBeTruthy();

    const response = await page.request.post(PROBE, {
      data: {},
      headers: { "x-csrf-token": csrf!.value },
    });

    // Past the CSRF gate: the probe path itself resolves to 404.
    expect(response.status()).not.toBe(403);
  });

  test("does not gate safe methods", async ({ page }) => {
    const response = await page.request.get(PROBE);

    expect(response.status()).not.toBe(403);
  });

  test("exempts the auth endpoints, which validate their own input", async ({
    page,
  }) => {
    // /api/auth/* is intentionally skipped by the CSRF gate, so a malformed
    // login must fail as bad input (400/401), never as "Invalid CSRF token".
    const response = await page.request.post("/api/auth/login", {
      data: {},
      headers: { "content-type": "application/json" },
    });

    expect(response.status()).not.toBe(403);
  });
});

test.describe("auth redirect", () => {
  test("protected page redirects to login once the session is gone", async ({
    page,
  }) => {
    await page.context().clearCookies();

    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login/);
  });

  test("keeps the original destination in the redirect", async ({ page }) => {
    await page.context().clearCookies();

    await page.goto("/settings");

    await expect(page).toHaveURL(/redirect=/);
  });
});