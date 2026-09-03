import { test, expect } from "@playwright/test";

/**
 * E2E coverage for the operator confirm modal in IncidentsPanel
 * (`apps/web/components/IncidentsPanel.tsx`, task D-4.2).
 *
 * Mirrors the `chat-abstention.spec.ts` pattern: every API is mocked via
 * `page.route` so this test never touches Postgres or the agent-core runtime.
 * The exercise is small but covers the four contract points:
 *
 *  1. The "Marcar como confirmado" button appears on `resolved` incident rows.
 *  2. Clicking the button opens the modal with the three required inputs.
 *  3. Submitting calls `POST /api/incidents/:id/confirm` with the entered body.
 *  4. The success state renders, and the panel is refreshed afterwards.
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

const RESOLVED_INCIDENT = {
  id: "inc-resolved-1",
  deviceKind: "ONU",
  deviceId: "ONU-1021",
  title: "RX bajo sostenido",
  description: "La ONU pierde paquetes cada 5 min.",
  severity: "critical",
  status: "resolved",
  firstSeenAt: "2026-09-01T08:00:00.000Z",
  lastSeenAt: "2026-09-01T09:00:00.000Z",
  alertCount: 4,
};

const OPEN_INCIDENT = {
  ...RESOLVED_INCIDENT,
  id: "inc-open-2",
  title: "OLT caída",
  status: "open",
};

const INITIAL_INCIDENTS = {
  incidents: [RESOLVED_INCIDENT, OPEN_INCIDENT],
  count: 2,
};

async function mockAllRoutes(
  page: import("@playwright/test").Page,
  opts: { confirmStatus?: number; confirmError?: string } = {},
) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: MOCK_ME_RESPONSE }),
  );

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

  await page.route("**/api/alerts", (route) =>
    route.fulfill({
      json: {
        alerts: [],
        count: 0,
        dataSource: { mode: "live", provider: "SMARTOLT", label: "SmartOLT prod" },
      },
    }),
  );

  // First GET returns the initial list; subsequent GETs (after the panel
  // refetches on confirm success) return the same list so the panel stays
  // stable in the e2e view.
  let incidentsCalls = 0;
  await page.route("**/api/incidents", (route) => {
    if (route.request().method() === "GET") {
      incidentsCalls += 1;
      return route.fulfill({ json: INITIAL_INCIDENTS });
    }
    return route.continue();
  });

  await page.route("**/api/incidents/inc-resolved-1/confirm", (route) => {
    const status = opts.confirmStatus ?? 201;
    return route.fulfill({
      status,
      json: status === 201
        ? {
            id: "ci-1",
            tenantId: "tenant-1",
            deviceKind: "ONU",
            deviceId: "ONU-1021",
            sourceIncidentId: "inc-resolved-1",
            sourceTool: "__operator_confirm__",
            summary: "RX bajo",
            rootCause: "Conector sucio",
            fix: "Limpieza",
            confirmedBy: "operator",
            confirmedByUserId: "user-1",
            observedAt: "2026-09-01T08:00:00.000Z",
            resolvedAt: "2026-09-01T09:00:00.000Z",
            createdAt: "2026-09-01T09:00:00.000Z",
            updatedAt: "2026-09-01T09:00:00.000Z",
            searchTokens: "conector sucio limpieza rx bajo",
          }
        : { error: opts.confirmError ?? "Solo se pueden confirmar incidentes resueltos." },
    });
  });

  return { incidentsCalls: () => incidentsCalls };
}

test.describe("IncidentsPanel confirm modal (WU4)", () => {
  test("renders the confirm button only on resolved rows and submits to the API", async ({ page }) => {
    const tracker = await mockAllRoutes(page);

    await page.goto("/dashboard");

    // Panel heading is rendered once the GET resolves.
    await expect(page.getByText("Incidentes correlacionados")).toBeVisible({ timeout: 10_000 });

    // Resolved row carries the confirm button; open row does not.
    const resolvedRow = page.locator('[data-testid="incident-row-inc-resolved-1"]');
    const openRow = page.locator('[data-testid="incident-row-inc-open-2"]');
    await expect(resolvedRow).toBeVisible();
    await expect(openRow).toBeVisible();
    await expect(resolvedRow.getByRole("button", { name: "Marcar como confirmado" })).toBeVisible();
    await expect(openRow.getByRole("button", { name: "Marcar como confirmado" })).toHaveCount(0);

    // Open the modal and fill the three fields.
    await resolvedRow.getByRole("button", { name: "Marcar como confirmado" }).click();
    const modal = page.locator('[data-testid="confirm-modal"]');
    await expect(modal).toBeVisible();
    await modal.locator('[data-testid="confirm-root-cause"]').fill("Conector sucio en la NAP");
    await modal.locator('[data-testid="confirm-fix"]').fill("Limpieza y reempalme del conector");
    await modal.locator('[data-testid="confirm-summary"]').fill("RX bajo sostenido ONU-1021");

    // Capture the POST to assert the body the UI sends.
    let confirmBody: unknown = null;
    page.on("request", (req) => {
      if (req.url().endsWith("/api/incidents/inc-resolved-1/confirm") && req.method() === "POST") {
        confirmBody = JSON.parse(req.postData() ?? "{}");
      }
    });

    await modal.getByRole("button", { name: "Confirmar" }).click();

    // The success state shows the green confirmation copy.
    await expect(modal.getByText("Incidente confirmado y guardado en memoria de la IA.")).toBeVisible({
      timeout: 5_000,
    });

    expect(confirmBody).toEqual({
      rootCause: "Conector sucio en la NAP",
      fix: "Limpieza y reempalme del conector",
      summary: "RX bajo sostenido ONU-1021",
    });

    // The panel refetched at least once after the success.
    expect(tracker.incidentsCalls()).toBeGreaterThanOrEqual(2);
  });

  test("shows the inline error when the confirm API returns 409", async ({ page }) => {
    await mockAllRoutes(page, { confirmStatus: 409, confirmError: "Solo se pueden confirmar incidentes resueltos." });

    await page.goto("/dashboard");
    const resolvedRow = page.locator('[data-testid="incident-row-inc-resolved-1"]');
    await expect(resolvedRow).toBeVisible({ timeout: 10_000 });
    await resolvedRow.getByRole("button", { name: "Marcar como confirmado" }).click();

    const modal = page.locator('[data-testid="confirm-modal"]');
    await modal.locator('[data-testid="confirm-root-cause"]').fill("Conector sucio");
    await modal.locator('[data-testid="confirm-fix"]').fill("Limpieza");
    await modal.locator('[data-testid="confirm-summary"]').fill("RX bajo");
    await modal.getByRole("button", { name: "Confirmar" }).click();

    await expect(modal.getByText("Este incidente ya no está resuelto.")).toBeVisible({ timeout: 5_000 });
  });
});