import { test, expect } from "@playwright/test";

const MOCK_ME_RESPONSE = {
  user: {
    id: "user-e2e-1",
    email: "operator@isp.com",
    name: "NOC Operator",
    role: "OWNER",
    tenantId: "tenant-e2e-1",
    tenant: { id: "tenant-e2e-1", name: "ISP", slug: "isp" },
  },
};

const INCIDENT = {
  id: "inc-card-1",
  deviceKind: "ONU",
  deviceId: "ONU-9901",
  title: "Degradación de potencia óptica",
  description: "Atenuación severa detectada en la interfaz PON.",
  severity: "critical",
  status: "open",
  firstSeenAt: "2026-09-09T08:00:00.000Z",
  lastSeenAt: "2026-09-09T09:00:00.000Z",
  alertCount: 3,
};

const READY_RESULT = {
  schema: "ftth.investigation-result.v1",
  resultId: "res-e2e-1",
  runId: "r_e2e_1",
  versionId: "v_e2e_0",
  tenantId: "tenant-e2e-1",
  connectionId: "conn-1",
  incidentId: "inc-card-1",
  windowStart: "2026-09-08T00:00:00.000Z",
  windowEnd: "2026-09-09T00:00:00.000Z",
  windowDays: 1,
  cutoffAt: "2026-09-09T09:00:00.000Z",
  rulesetVersion: "rules@1.0.0",
  modelVersion: "claude-3-5-sonnet",
  promptVersion: "prompt@1.0.0",
  sufficiency: "sufficient",
  sufficiencyReason: "Telemetría óptica y eventos de reinicio confirman degradación física de enlace.",
  producedAt: "2026-09-09T09:05:00.000Z",
  producedBy: "agent-core@1.0.0",
  evidenceRefs: [
    {
      evidenceRefId: "ev-rx-power",
      kind: "metric",
      source: "telemetry:rx_power",
      observedAt: "2026-09-09T09:00:00.000Z",
      summary: "rx_power: -28.5 dBm",
      quality: "fresh",
      qualityReason: "within_ttl",
    },
  ],
  hypotheses: [
    {
      hypothesisId: "hyp-dirty-connector",
      summary: "Suciedad en el conector óptico o curvatura en acometida.",
      supportLevel: "supported",
      forRefIds: ["ev-rx-power"],
      againstRefIds: [],
    },
  ],
  contradictions: [],
  missing: [],
  suggestedChecks: [
    {
      checkId: "chk-inspect-port",
      kind: "observe_only",
      description: "Verificar niveles de potencia óptica en la OLT",
      expectedToResolve: "Confirmar si la degradación es en el puerto o en la ONU",
    },
  ],
};

async function fulfillJson(
  route: import("@playwright/test").Route,
  json: unknown,
  status = 200,
) {
  await route.fulfill({ status, json: json as object });
}

async function mockSessionAndBase(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    fulfillJson(route, MOCK_ME_RESPONSE),
  );
  await page.route("**/api/connectors", (route) =>
    fulfillJson(route, { connectors: [] }),
  );
  await page.route("**/api/topology/downstream**", (route) =>
    fulfillJson(route, {
      schema: "ftth.topology.v1",
      kind: "ONU",
      id: "ONU-9901",
      onuIds: ["ONU-9901"],
      edgesTraversed: 1,
    }),
  );
  await page.route("**/api/alerts", (route) =>
    fulfillJson(route, {
      alerts: [],
      count: 0,
      dataSource: { mode: "live", provider: "SMARTOLT", label: "SmartOLT prod" },
    }),
  );
  await page.route("**/api/incidents", (route) =>
    fulfillJson(route, { incidents: [INCIDENT], count: 1 }),
  );
}

test.describe("InvestigationCard — Gate 3 UI E2E Acceptance", () => {
  test("expands investigation card, displays explainable hypotheses, and submits human feedback", async ({
    page,
  }) => {
    await mockSessionAndBase(page);

    await page.route("**/api/incidents/inc-card-1/investigate", (route) => {
      return fulfillJson(route, {
        runId: "r_e2e_1",
        status: "ready",
        requestedAt: "2026-09-09T09:00:00.000Z",
        version: {
          versionId: "v_e2e_0",
          versionIndex: 0,
          rulesetVersion: "rules@1.0.0",
          modelVersion: "claude-3-5-sonnet",
          snapshotAt: "2026-09-09T09:05:00.000Z",
          snapshot: READY_RESULT,
        },
      });
    });

    let submittedFeedback: { label: string } | null = null;
    await page.route("**/api/investigations/r_e2e_1/versions/v_e2e_0/feedback", async (route) => {
      const data = (await route.request().postDataJSON()) as { label: string };
      submittedFeedback = data;
      return fulfillJson(
        route,
        {
          feedbackId: "fb-card-1",
          runId: "r_e2e_1",
          versionId: "v_e2e_0",
          label: data.label,
          submittedAt: "2026-09-09T09:10:00.000Z",
        },
        201,
      );
    });

    let feedbacksCalls = 0;
    await page.route("**/api/investigations/r_e2e_1/feedbacks", (route) => {
      feedbacksCalls += 1;
      if (feedbacksCalls === 1) {
        return fulfillJson(route, { feedbacks: [] });
      }
      return fulfillJson(route, {
        feedbacks: [
          {
            feedbackId: "fb-card-1",
            runId: "r_e2e_1",
            versionId: "v_e2e_0",
            label: "confirmed",
            submittedAt: "2026-09-09T09:10:00.000Z",
          },
        ],
      });
    });

    await page.goto("/dashboard");

    // Expand cognitive investigation card
    const toggleButton = page.getByTestId("toggle-investigation-inc-card-1");
    await expect(toggleButton).toBeVisible();
    await toggleButton.click();

    // Verify card rendered
    const card = page.getByTestId("investigation-card-inc-card-1");
    await expect(card).toBeVisible();

    // Verify sufficiency status badge
    const badge = page.getByTestId("investigation-sufficiency-badge-inc-card-1");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("Suficiente");

    // Verify hypothesis and explainable support
    const hyp = page.getByTestId("investigation-hypothesis-hyp-dirty-connector");
    await expect(hyp).toBeVisible();
    await expect(hyp).toContainText("Suciedad en el conector óptico");
    await expect(hyp).toContainText("Respaldada");
    await expect(hyp).toContainText("ev-rx-power");

    // Verify evidence list
    const evList = page.getByTestId("investigation-evidence-list-inc-card-1");
    await expect(evList).toBeVisible();
    await expect(evList).toContainText("rx_power: -28.5 dBm");
    await expect(evList).toContainText("Vigente");

    // Submit human feedback through investigation card
    const confirmBtn = page.getByTestId("investigation-feedback-btn-confirmed-inc-card-1");
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    expect(submittedFeedback).toEqual({ label: "confirmed" });
  });

  test("handles pending polling state (HTTP 202) and triggers refresh on reinvestigate", async ({
    page,
  }) => {
    await mockSessionAndBase(page);

    let pendingServed = false;
    await page.route("**/api/incidents/inc-card-1/investigate", async (route) => {
      if (route.request().method() === "POST") {
        let body: { refresh?: boolean } = {};
        try {
          body = (route.request().postDataJSON() ?? {}) as { refresh?: boolean };
        } catch {
          body = {};
        }
        if (body.refresh) {
          return fulfillJson(route, {
            runId: "r_e2e_1",
            status: "ready",
            version: {
              versionId: "v_e2e_1",
              versionIndex: 1,
              snapshot: { ...READY_RESULT, versionId: "v_e2e_1" },
            },
          });
        }
        return fulfillJson(route, {
          runId: "r_e2e_1",
          versionId: "v_e2e_0",
          status: "ready",
          idempotent: false,
        });
      }

      if (!pendingServed) {
        pendingServed = true;
        return fulfillJson(
          route,
          {
            runId: "r_e2e_1",
            status: "pending",
            retryAfterMs: 400,
          },
          202,
        );
      }

      return fulfillJson(route, {
        runId: "r_e2e_1",
        status: "ready",
        version: {
          versionId: "v_e2e_0",
          versionIndex: 0,
          snapshot: READY_RESULT,
        },
      });
    });

    await page.route("**/api/investigations/r_e2e_1/feedbacks", (route) =>
      fulfillJson(route, { feedbacks: [] }),
    );

    await page.goto("/dashboard");

    const toggleButton = page.getByTestId("toggle-investigation-inc-card-1");
    await toggleButton.click();

    // In-flight pending indicator should appear during pending status
    const pendingMsg = page.getByTestId("investigation-pending-inc-card-1");
    await expect(pendingMsg).toBeVisible();

    // After poll resolves, the result appears
    const badge = page.getByTestId("investigation-sufficiency-badge-inc-card-1");
    await expect(badge).toBeVisible();

    // Click Reinvestigar button
    const refreshBtn = page.getByTestId("investigation-refresh-button-inc-card-1");
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Card remains visible with updated content
    await expect(badge).toHaveText("Suficiente");
  });
});
