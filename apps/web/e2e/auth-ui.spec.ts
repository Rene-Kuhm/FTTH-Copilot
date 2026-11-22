import { test, expect } from "@playwright/test";

const MOCK_USER = {
  email: "test@isp.com",
  password: "testpass123",
  name: "Test User",
  tenantName: "Test ISP",
};

const MOCK_ME_RESPONSE = {
  user: {
    id: "user-1",
    email: MOCK_USER.email,
    name: MOCK_USER.name,
    role: "OWNER",
    tenantId: "tenant-1",
    tenant: { id: "tenant-1", name: MOCK_USER.tenantName, slug: "test-isp" },
  },
};

const MOCK_ME_ANONYMOUS = { user: null };

async function mockAuthRoutes(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/me", (route) => {
    const cookies = route.request().headers()["cookie"] ?? "";
    if (cookies.includes("session=mock-token")) {
      return route.fulfill({ json: MOCK_ME_RESPONSE });
    }
    return route.fulfill({ json: MOCK_ME_ANONYMOUS });
  });

  await page.route("**/api/auth/login", async (route) => {
    const body = route.request().postDataJSON();
    if (body.email === "ratelimit@isp.com") {
      return route.fulfill({
        status: 429,
        json: { error: "Demasiados intentos. Probá de nuevo más tarde." },
        headers: { "retry-after": "42" },
      });
    }
    if (body.email === "mfa@isp.com" && body.password === MOCK_USER.password) {
      return route.fulfill({
        status: 200,
        json: { mfaRequired: true, tempToken: "temp-mfa-token" },
      });
    }
    if (body.email === MOCK_USER.email && body.password === MOCK_USER.password) {
      return route.fulfill({
        status: 200,
        json: { ok: true },
        headers: { "set-cookie": "session=mock-token; Path=/; HttpOnly" },
      });
    }
    return route.fulfill({
      status: 401,
      json: { error: "Credenciales inválidas" },
    });
  });

  await page.route("**/api/auth/mfa/verify", async (route) => {
    const body = route.request().postDataJSON();
    if (body.tempToken === "temp-mfa-token" && body.code === "123456") {
      return route.fulfill({
        status: 200,
        json: { ok: true },
        headers: { "set-cookie": "session=mock-token; Path=/; HttpOnly" },
      });
    }
    if (body.tempToken === "temp-mfa-token" && body.code === "000000") {
      return route.fulfill({
        status: 401,
        json: { error: "Invalid MFA code" },
      });
    }
    return route.fulfill({
      status: 429,
      json: { error: "Demasiados intentos. Probá de nuevo más tarde." },
      headers: { "retry-after": "30" },
    });
  });

  await page.route("**/api/auth/signup", async (route) => {
    const body = route.request().postDataJSON();
    if (body.email && body.password && body.name && body.tenantName) {
      return route.fulfill({
        status: 201,
        json: { ok: true },
        headers: { "set-cookie": "session=mock-token; Path=/; HttpOnly" },
      });
    }
    return route.fulfill({
      status: 400,
      json: { error: "Faltan campos" },
    });
  });

  await page.route("**/api/auth/logout", (route) => {
    return route.fulfill({
      status: 200,
      json: { ok: true },
      headers: { "set-cookie": "session=; Path=/; HttpOnly; Max-Age=0" },
    });
  });
}

test.describe("Auth flows", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto("/app");
    await page.waitForSelector("text=Iniciar sesión", { timeout: 10_000 });
  });

  test("anonymous users see a neutral login state", async ({ page }) => {
    await expect(page.locator('form [role="alert"]')).toHaveCount(0);
    await expect(page.getByText('Not authenticated')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Inicia(r)? sesión/ }).first()).toBeVisible();
  });

  test("signup flow: fill form, submit, verify session appears", async ({ page }) => {
    await page.click("text=Crear cuenta");

    await page.fill('input[placeholder="Tu nombre"]', MOCK_USER.name);
    await page.fill('input[placeholder="Nombre de tu ISP/empresa"]', MOCK_USER.tenantName);
    await page.fill('input[placeholder="email@ejemplo.com"]', MOCK_USER.email);
    await page.fill('input[placeholder*="contraseña"]', MOCK_USER.password);

    await page.click('button[type="submit"]:has-text("Crear cuenta")');

    await expect(page.getByText('Activa', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`text=${MOCK_USER.email}`)).toBeVisible();
  });

  test("login flow: fill form, submit, verify session appears", async ({ page }) => {
    await page.click("text=Iniciar sesión");

    await page.fill('input[placeholder="email@ejemplo.com"]', MOCK_USER.email);
    await page.fill('input[placeholder*="contraseña"]', MOCK_USER.password);

    await page.click('button[type="submit"]:has-text("Entrar")');

    await expect(page.getByText('Activa', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`text=${MOCK_USER.email}`)).toBeVisible();
  });

  test("logout: click logout, verify form buttons reappear", async ({ page }) => {
    // First log in
    await page.click("text=Iniciar sesión");
    await page.fill('input[placeholder="email@ejemplo.com"]', MOCK_USER.email);
    await page.fill('input[placeholder*="contraseña"]', MOCK_USER.password);
    await page.click('button[type="submit"]:has-text("Entrar")');
    await expect(page.getByText('Activa', { exact: true })).toBeVisible({ timeout: 5_000 });

    // Now logout
    await page.click("text=Salir");

    await expect(page.locator("text=Iniciar sesión").first()).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("link", { name: "Crear cuenta" }).or(page.getByRole("button", { name: "Crear cuenta" })).first(),
    ).toBeVisible();
  });

  test("invalid credentials: wrong password shows error", async ({ page }) => {
    await page.click("text=Iniciar sesión");

    await page.fill('input[placeholder="email@ejemplo.com"]', MOCK_USER.email);
    await page.fill('input[placeholder*="contraseña"]', "wrongpassword");

    await page.click('button[type="submit"]:has-text("Entrar")');

    await expect(page.locator("text=Credenciales inválidas")).toBeVisible({ timeout: 5_000 });
  });

  test("mfa challenge: complete login after valid TOTP", async ({ page }) => {
    await page.click("text=Iniciar sesión");
    await page.fill('input[placeholder="email@ejemplo.com"]', "mfa@isp.com");
    await page.fill('input[placeholder*="contraseña"]', MOCK_USER.password);
    await page.click('button[type="submit"]:has-text("Entrar")');

    await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
    await expect(page.getByLabel("Código TOTP")).toBeFocused();
    await page.getByLabel("Código TOTP").fill("123456");
    await page.click('button[type="submit"]:has-text("Verificar")');

    await expect(page.getByText("Activa", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("mfa challenge: invalid code and 429 show clear errors", async ({ page }) => {
    await page.click("text=Iniciar sesión");
    await page.fill('input[placeholder="email@ejemplo.com"]', "mfa@isp.com");
    await page.fill('input[placeholder*="contraseña"]', MOCK_USER.password);
    await page.click('button[type="submit"]:has-text("Entrar")');
    await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();

    await page.getByLabel("Código TOTP").fill("000000");
    await page.click('button[type="submit"]:has-text("Verificar")');
    await expect(page.locator('form [role="alert"]')).toContainText("Invalid MFA code");

    await page.getByLabel("Código TOTP").fill("999999");
    await page.click('button[type="submit"]:has-text("Verificar")');
    await expect(page.locator('form [role="alert"]')).toContainText("30");
  });

  test("login 429 rate limit shows retry-after seconds", async ({ page }) => {
    await page.click("text=Iniciar sesión");
    await page.fill('input[placeholder="email@ejemplo.com"]', "ratelimit@isp.com");
    await page.fill('input[placeholder*="contraseña"]', MOCK_USER.password);
    await page.click('button[type="submit"]:has-text("Entrar")');

    const alert = page.locator('form [role="alert"]');
    await expect(alert).toContainText("42");
    await expect(alert).toContainText("Intentá de nuevo en 42 segundos.");
  });
});
