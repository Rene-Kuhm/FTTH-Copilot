import { test, expect } from "@playwright/test";

/**
 * E2E coverage for the Phase 3 abstention bubble in ChatUI
 * (`apps/web/components/ChatUI.tsx`, task 3.3).
 *
 * The route is mocked so this test never touches Postgres or the
 * agent-core runtime. It only proves that:
 *
 *   1. When `toolsUsed` carries a synthetic `__abstention__` row, the
 *      ChatUI renders a warning-tint bubble with the rendered Spanish
 *      nextStep and a bullet per missing tool.
 *   2. The synthetic `__abstention__` row is NOT rendered as a regular
 *      tool chip — the operator sees only the real tool name.
 *
 * The Playwright test runner is the only sensible harness for React
 * component rendering here: there is no Vitest + jsdom harness in
 * apps/web, and adding one would exceed the work-unit budget. The
 * component is small enough that the e2e assertion surface (heading +
 * bullet text + chip presence) is a tight signal.
 */

const MOCK_ME_RESPONSE = {
  user: {
    id: "user-1",
    email: "ops@isp.com",
    name: "Ops",
    role: "OWNER",
    tenantId: "tenant-1",
    tenant: { id: "tenant-1", name: "ISP", slug: "isp" },
  },
};

const ABSTENTION_TEXT =
  "No puedo responder con la evidencia disponible.\n\n" +
  "Falta evidencia de:\n" +
  "- get_onu_detail\n\n" +
  "No pude respaldar el diagnóstico: el identificador get_onu_detail no figura en el NMS. Verificá el identificador (ID, SN o filtro) y volvé a intentar.";

const ABSTENTION_ENVELOPE = {
  schema: "ftth.abstention.v1",
  reason: "incomplete",
  severity: "critical",
  missing: ["get_onu_detail"],
  available: [],
  nextStep:
    "No pude respaldar el diagnóstico: el identificador get_onu_detail no figura en el NMS. Verificá el identificador (ID, SN o filtro) y volvé a intentar.",
  toolsAffected: ["get_onu_detail"],
};

async function mockAllRoutes(
  page: import("@playwright/test").Page,
  opts: { withAbstention: boolean },
) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: MOCK_ME_RESPONSE }),
  );

  await page.route("**/api/chat", (route) => {
    if (opts.withAbstention) {
      return route.fulfill({
        status: 200,
        json: {
          reply: ABSTENTION_TEXT,
          toolsUsed: [
            { name: "__abstention__", args: {} },
            { name: "get_onu_detail", args: {} },
          ],
          conversationId: "mock-conv-abst-1",
          dataSource: {
            mode: "live",
            provider: "SMARTOLT",
            label: "SmartOLT prod",
          },
          abstention: ABSTENTION_ENVELOPE,
        },
      });
    }
    return route.fulfill({
      status: 200,
      json: {
        reply: "Mock response from E2E test",
        toolsUsed: [{ name: "list_onus", args: {} }],
        conversationId: "mock-conv-1",
        dataSource: {
          mode: "live",
          provider: "SMARTOLT",
          label: "SmartOLT prod",
        },
      },
    });
  });

  await page.route("**/api/connectors", (route) =>
    route.fulfill({
      json: {
        connectors: [
          {
            id: "conn-1",
            provider: "SMARTOLT",
            label: "SmartOLT prod",
            baseUrl: "https://api.smartolt.com",
            status: "connected",
            lastCheckedAt: null,
            lastError: null,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    }),
  );
}

test.describe("ChatUI abstention bubble", () => {
  test("renders warning bubble with missing + nextStep bullets", async ({
    page,
  }) => {
    await mockAllRoutes(page, { withAbstention: true });
    await page.goto("/app");

    const chatInput = page.getByRole("textbox", {
      name: "Pregunta para el Copilot",
    });
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    await chatInput.fill("Detalle de la ONU SN-001");
    await page.getByRole("button", { name: "Enviar mensaje" }).click();

    // Heading is the operator-facing Spanish warning.
    await expect(
      page.getByRole("heading", { name: /No se pudo respaldar el diagn/ }),
    ).toBeVisible({ timeout: 5_000 });

    // The bullet list references the missing tool and the remediation
    // hint copied verbatim from the abstention envelope.
    await expect(page.locator("text=get_onu_detail").first()).toBeVisible();
    await expect(
      page.locator("text=/Verific.*identificador/").first(),
    ).toBeVisible();

    // The synthetic __abstention__ chip must NOT appear as a regular
    // tool chip — only the real tool name shows under "Herramientas:".
    const chip = page.locator("text=Herramientas:").locator("..");
    await expect(chip).toBeVisible();
    await expect(chip.locator("text=get_onu_detail")).toBeVisible();
    await expect(chip.locator("text=__abstention__")).toHaveCount(0);
  });

  test("non-abstention responses do not render the warning bubble", async ({
    page,
  }) => {
    await mockAllRoutes(page, { withAbstention: false });
    await page.goto("/app");

    const chatInput = page.getByRole("textbox", {
      name: "Pregunta para el Copilot",
    });
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    await chatInput.fill("¿Cuántas ONUs hay?");
    await page.getByRole("button", { name: "Enviar mensaje" }).click();

    await expect(page.locator("text=Mock response from E2E test")).toBeVisible(
      { timeout: 5_000 },
    );
    await expect(
      page.getByRole("heading", { name: /No se pudo respaldar el diagn/ }),
    ).toHaveCount(0);
  });
});
