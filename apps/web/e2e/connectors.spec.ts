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

// WebKit neither applies Set-Cookie from a fulfilled response nor exposes the
// Cookie header to route handlers, so the signed-in state is tracked here and
// the cookie jar is read through the context.
async function hasSessionCookie(page: import("@playwright/test").Page): Promise<boolean> {
  return (await page.context().cookies()).some(
    (cookie) => cookie.name === "session" && cookie.value === "mock-token",
  );
}

async function loginViaUI(page: import("@playwright/test").Page) {
  await page.click("text=Iniciar sesión");
  await page.fill('input[placeholder="email@ejemplo.com"]', "test@isp.com");
  await page.fill('input[placeholder*="contraseña"]', "testpass123");
  await page.click('button[type="submit"]:has-text("Entrar")');
  await expect(page.getByText('Activa', { exact: true })).toBeVisible({ timeout: 5_000 });
}

test.describe("Connectors", () => {
  test.beforeEach(async ({ page }) => {
    let signedIn = false;

    await page.route("**/api/auth/me", async (route) => {
      const isAuthed = signedIn || (await hasSessionCookie(page));
      return route.fulfill({ json: { user: isAuthed ? MOCK_ME_USER : null } });
    });

    await page.route("**/api/auth/login", (route) => {
      signedIn = true;
      return route.fulfill({
        status: 200,
        json: { ok: true },
        headers: { "set-cookie": "session=mock-token; Path=/; HttpOnly" },
      });
    });

    await page.route("**/api/auth/signup", (route) => {
      signedIn = true;
      return route.fulfill({
        status: 201,
        json: { ok: true },
        headers: { "set-cookie": "session=mock-token; Path=/; HttpOnly" },
      });
    });

    await page.route("**/api/auth/logout", (route) => {
      signedIn = false;
      return route.fulfill({
        status: 200,
        json: { ok: true },
      });
    });

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
        json: {
          reply: "Mock",
          toolsUsed: [],
          conversationId: "mock-1",
          dataSource: { mode: "live", provider: "SMARTOLT", label: "SmartOLT prod" },
        },
      })
    );
  });

  test("connector list: visible after login", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("text=Iniciar sesión")).toBeVisible({ timeout: 10_000 });

    await loginViaUI(page);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Conectores NMS' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("SmartOLT prod", { exact: true })).toBeVisible();
  });

  test("create connector: fill form, submit, appears in list", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("text=Iniciar sesión")).toBeVisible({ timeout: 10_000 });

    await loginViaUI(page);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Conectores NMS' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Agregar conector" }).click();
    await page.getByLabel("Proveedor").selectOption("MIKROWISP");
    await page.getByLabel("Etiqueta").fill("Mikrowisp test");
    await page.getByLabel("Clave de API").fill("test-api-key-123");
    await page.getByLabel("URL base").fill("https://demo.mikrowisp.com/api/v1");
    await page.getByRole("button", { name: "Guardar y probar" }).click();

    await expect(page.getByText("Mikrowisp test", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("connector section renders when pre-authenticated", async ({ page }) => {
    await page.context().addCookies([
      { name: "session", value: "mock-token", domain: "localhost", path: "/" },
    ]);
    await page.goto("/app");
    await expect(page.getByRole('heading', { name: 'Conectores NMS' })).toBeVisible({ timeout: 10_000 });
  });
});
