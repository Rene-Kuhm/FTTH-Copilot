import { test, expect } from "@playwright/test";

const MOCK_ME_USER = {
  id: "user-1",
  email: "test@isp.com",
  name: "Test User",
  role: "OWNER",
  tenantId: "tenant-1",
  tenant: { id: "tenant-1", name: "Test ISP", slug: "test-isp" },
};

const connectors: Array<{
  id: string;
  provider: string;
  label: string;
  baseUrl: string | null;
  status: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}> = [
  {
    id: "conn-1",
    provider: "SMARTOLT",
    label: "SmartOLT prod",
    baseUrl: "https://demo.smartolt.com",
    status: "connected",
    lastCheckedAt: "2026-08-20T10:00:00Z",
    lastError: null,
    createdAt: "2026-08-19T10:00:00Z",
  },
];

function hasSessionCookie(headers: Record<string, string>): boolean {
  const cookie = headers["cookie"] ?? "";
  return cookie.includes("session=mock-token");
}

async function loginViaUI(page: import("@playwright/test").Page) {
  await page.click("text=Iniciar sesión");
  await page.fill('input[placeholder="email@ejemplo.com"]', "test@isp.com");
  await page.fill('input[placeholder*="contraseña"]', "testpass123");
  await page.click('button[type="submit"]:has-text("Entrar")');
  await expect(page.locator("text=Sesión activa")).toBeVisible({ timeout: 5_000 });
}

test.describe("Connectors", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/me", (route) => {
      const isAuthed = hasSessionCookie(route.request().headers());
      return route.fulfill({ json: { user: isAuthed ? MOCK_ME_USER : null } });
    });

    await page.route("**/api/auth/login", (route) =>
      route.fulfill({
        status: 200,
        json: { ok: true },
        headers: { "set-cookie": "session=mock-token; Path=/; HttpOnly" },
      })
    );

    await page.route("**/api/auth/signup", (route) =>
      route.fulfill({
        status: 201,
        json: { ok: true },
        headers: { "set-cookie": "session=mock-token; Path=/; HttpOnly" },
      })
    );

    await page.route("**/api/auth/logout", (route) =>
      route.fulfill({
        status: 200,
        json: { ok: true },
      })
    );

    await page.route("**/api/connectors", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ json: { connectors } });
      }
      return route.fulfill({ json: { connectors } });
    });

    await page.route("**/api/connectors/create", async (route) => {
      const body = route.request().postDataJSON();
      const newConnector = {
        id: "conn-new",
        provider: body.provider,
        label: body.label,
        baseUrl: body.baseUrl ?? null,
        status: "pending",
        lastCheckedAt: null,
        lastError: null,
        createdAt: new Date().toISOString(),
      };
      connectors.push(newConnector);
      return route.fulfill({ status: 201, json: { connector: newConnector } });
    });

    await page.route("**/api/connectors/*/test", (route) =>
      route.fulfill({ json: { ok: true } })
    );

    await page.route("**/api/chat", (route) =>
      route.fulfill({
        json: { reply: "Mock", toolsUsed: [], conversationId: "mock-1" },
      })
    );
  });

  test("connector list: visible after login", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Iniciar sesión")).toBeVisible({ timeout: 10_000 });

    await loginViaUI(page);

    await page.reload();
    await expect(page.locator("text=NMS Connectors")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=SmartOLT prod")).toBeVisible();
  });

  test("create connector: fill form, submit, appears in list", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Iniciar sesión")).toBeVisible({ timeout: 10_000 });

    await loginViaUI(page);

    await page.reload();
    await expect(page.locator("text=NMS Connectors")).toBeVisible({ timeout: 10_000 });

    await page.click("text=+ Agregar connector");
    await page.fill('input[placeholder*="Etiqueta"]', "Mikrowisp test");
    await page.fill('input[placeholder*="API key"]', "test-api-key-123");
    await page.click('button:has-text("Guardar connector")');

    await expect(page.locator("text=Mikrowisp test")).toBeVisible({ timeout: 5_000 });
  });

  test("connector section renders when pre-authenticated", async ({ page }) => {
    await page.context().addCookies([
      { name: "session", value: "mock-token", domain: "localhost", path: "/" },
    ]);
    await page.goto("/");
    await expect(page.locator("text=NMS Connectors")).toBeVisible({ timeout: 10_000 });
  });
});
