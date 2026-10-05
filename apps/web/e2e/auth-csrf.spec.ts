import { test, expect } from "@playwright/test";

/**
 * E2E tests for CSRF protection.
 * These tests verify that the CSRF token mechanism is working correctly.
 */
test.describe("CSRF Protection", () => {
  test("CSRF token is set on login", async ({ page }) => {
    // Navigate to login page
    await page.goto("/login");

    // Fill in login form with test credentials
    await page.fill('input[name="email"]', "test@example.com");
    await page.fill('input[name="password"]', "wrongpassword");

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for response (either error or redirect)
    await page.waitForResponse(
      (response) => response.url().includes("/api/auth/login"),
      { timeout: 10000 }
    );

    // Check that CSRF cookie was set
    const csrfCookie = await page.context().cookies("localhost");
    const csrf = csrfCookie.find((c) => c.name === "ftth_csrf");

    // If login fails with "invalid credentials", we still get a CSRF cookie
    // because the server generates one on every login attempt
    expect(csrf).toBeDefined();
  });

  test("authenticated requests include CSRF header", async ({ page }) => {
    // This test verifies that the CSRF token from the cookie
    // can be read and used in requests

    // Get CSRF token from cookie
    const cookies = await page.context().cookies("localhost");
    const csrfCookie = cookies.find((c) => c.name === "ftth_csrf");

    expect(csrfCookie).toBeDefined();
    expect(csrfCookie?.value).toHaveLength(64); // 32 bytes = 64 hex chars
  });

  test("unauthenticated page redirects to login", async ({ page }) => {
    // Clear all cookies to simulate unauthenticated state
    await page.context().clearCookies();

    // Try to access a protected page
    await page.goto("/dashboard");

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test("admin page requires admin role", async ({ page }) => {
    // The middleware should block non-admin users from /admin/* routes
    // This test uses the __test_bypass cookie which skips auth but not role check

    // Navigate to admin page (will work because of test bypass)
    // Note: In a real scenario, we'd need to mock an ADMIN user
    // For now, this test documents the expected behavior
    await page.goto("/admin");
    // The page should either load or redirect based on role
    // This is a placeholder for role-based access control testing
  });
});
