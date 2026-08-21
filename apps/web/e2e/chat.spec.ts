import { test, expect } from "@playwright/test";

const MOCK_CHAT_RESPONSE = {
  reply: "Mock response from E2E test",
  toolsUsed: [{ name: "list_onus", args: {} }],
  conversationId: "mock-conv-123",
  dataSource: { mode: "live", provider: "SMARTOLT", label: "SmartOLT prod" },
};

const MOCK_ME_RESPONSE = {
  user: {
    id: "user-1",
    email: "test@isp.com",
    name: "Test User",
    role: "OWNER",
    tenantId: "tenant-1",
    tenant: { id: "tenant-1", name: "Test ISP", slug: "test-isp" },
  },
};

let chatRequestBodies: Array<{ message: string; conversationId?: string; connectionId?: string }> = [];

async function mockAllRoutes(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: MOCK_ME_RESPONSE })
  );

  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      message: string;
      conversationId?: string;
      connectionId?: string;
    };
    chatRequestBodies.push(body);
    return route.fulfill({
      status: 200,
      json: {
        ...MOCK_CHAT_RESPONSE,
        conversationId: body.conversationId ?? MOCK_CHAT_RESPONSE.conversationId,
      },
    });
  });

  await page.route("**/api/connectors", (route) =>
    route.fulfill({ json: { connectors: [{ id: 'conn-1', provider: 'SMARTOLT', label: 'SmartOLT prod', baseUrl: 'https://api.smartolt.com', status: 'connected', lastCheckedAt: null, lastError: null, createdAt: new Date().toISOString() }] } })
  );
}

test.describe("Chat", () => {
  test.beforeEach(async ({ page }) => {
    chatRequestBodies = [];
    await mockAllRoutes(page);
    await page.goto("/app");
  });

  test("send message: type, send, verify response appears", async ({ page }) => {
    const chatInput = page.getByRole("textbox", { name: "Pregunta para el Copilot" });
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    await chatInput.fill("¿Cuántas ONUs están offline?");
    await page.getByRole("button", { name: "Enviar mensaje" }).click();

    await expect(page.locator("text=¿Cuántas ONUs están offline?")).toBeVisible();
    await expect(page.locator("text=Mock response from E2E test")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("empty message: send button disabled when input is empty", async ({ page }) => {
    const sendButton = page.getByRole("button", { name: "Enviar mensaje" });
    await expect(sendButton).toBeVisible({ timeout: 10_000 });

    await expect(sendButton).toBeDisabled();
  });

  test("conversation persistence: conversationId sent in subsequent requests", async ({ page }) => {
    const chatInput = page.getByRole("textbox", { name: "Pregunta para el Copilot" });
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    // First message
    await chatInput.fill("First message");
    await page.getByRole("button", { name: "Enviar mensaje" }).click();
    await expect(page.locator("text=Mock response from E2E test")).toBeVisible({
      timeout: 5_000,
    });

    // Second message - should include conversationId from first response
    await chatInput.fill("Second message");
    await page.getByRole("button", { name: "Enviar mensaje" }).click();
    await expect(page.locator("text=Second message")).toBeVisible();
    await expect(page.locator("text=Mock response from E2E test").nth(1)).toBeVisible({
      timeout: 5_000,
    });
    expect(chatRequestBodies).toHaveLength(2);
    expect(chatRequestBodies[1]?.conversationId).toBe("mock-conv-123");
    expect(chatRequestBodies[1]?.connectionId).toBe("conn-1");
  });

  test("suggested questions appear when no messages", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Hacé tu primera pregunta" })
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "¿Cuántas ONUs están offline ahora?" })
    ).toBeVisible();
  });
});
