import { test, expect } from "@playwright/test";

/**
 * E2E coverage for the cognitive-investigation feedback controls
 * (`apps/web/components/FeedbackControls.tsx`, task Fase 1 PR #4).
 *
 * The component talks to two new routes:
 *   POST /api/incidents/:id/investigate
 *   POST /api/investigations/:runId/versions/:versionId/feedback
 *   GET  /api/investigations/:runId/feedbacks
 *
 * The test mocks the session + the new routes via `page.route`, drives the
 * UI buttons, and asserts that the rendered history updates with the
 * submitted label. It deliberately avoids mocking the four
 * /api/incidents/:id/confirm flow that this PR does NOT change.
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

const INCIDENT = {
  id: "inc-feedback-1",
  deviceKind: "ONU",
  deviceId: "ONU-2042",
  title: "Latencia elevada",
  description: "Pings por encima del SLA.",
  severity: "warning",
  status: "open",
  firstSeenAt: "2026-09-05T08:00:00.000Z",
  lastSeenAt: "2026-09-05T09:00:00.000Z",
  alertCount: 2,
};

const INVESTIGATE_RESPONSE = {
  runId: "r_fixture",
  versionId: "v_init",
  status: "pending",
  idempotent: false,
};

async function fulfillJson(
  route: import("@playwright/test").Route,
  json: unknown,
  status = 200,
) {
  await route.fulfill({ status, json: json as object });
}

async function mockSessionAndConnectors(
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
      id: "ONU-2042",
      onuIds: ["ONU-2042"],
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
}

test.describe("FeedbackControls", () => {
  test("opens an investigation and records a confirmed feedback through the UI", async ({
    page,
  }) => {
    await mockSessionAndConnectors(page);

    await page.route("**/api/incidents", (route) =>
      fulfillJson(route, { incidents: [INCIDENT], count: 1 }),
    );

    let investigateCalls = 0;
    await page.route(
      "**/api/incidents/inc-feedback-1/investigate",
      (route) => {
        investigateCalls += 1;
        return fulfillJson(route, INVESTIGATE_RESPONSE, 201);
      },
    );

    let feedbackPosts: Array<{ runId: string; versionId: string; label: string }> = [];
    await page.route(
      "**/api/investigations/*/versions/*/feedback",
      (route) => {
        const url = new URL(route.request().url());
        const parts = url.pathname.split("/");
        const runId = parts[parts.indexOf("investigations") + 1] ?? "";
        const versionId = parts[parts.indexOf("versions") + 1] ?? "";
        feedbackPosts.push({ runId, versionId, label: "confirmed" });
        return fulfillJson(
          route,
          {
            feedbackId: "f_e2e_1",
            runId,
            versionId,
            label: "confirmed",
            observations: null,
            realCause: null,
            resolutionEvidence: null,
            authorUserId: "user-1",
            submittedAt: "2026-09-07T10:00:00.000Z",
            idempotent: false,
            idempotencyKey: "tenant-1\u0001r_fixture\u0001v_init\u0001user-1\u0001confirmed",
          },
          201,
        );
      },
    );

    // First GET returns the empty list; the POST above triggers a refresh
    // that returns the new row.
    let feedbacksReads = 0;
    await page.route("**/api/investigations/r_fixture/feedbacks", (route) => {
      feedbacksReads += 1;
      if (feedbacksReads === 1) {
        return fulfillJson(route, {
          runId: "r_fixture",
          status: "pending",
          requestedAt: "2026-09-07T09:00:00.000Z",
          feedbacks: [],
          count: 0,
          limit: 50,
        });
      }
      return fulfillJson(route, {
        runId: "r_fixture",
        status: "pending",
        requestedAt: "2026-09-07T09:00:00.000Z",
        feedbacks: [
          {
            feedbackId: "f_e2e_1",
            runId: "r_fixture",
            versionId: "v_init",
            label: "confirmed",
            observations: null,
            realCause: null,
            resolutionEvidence: null,
            authorUserId: "user-1",
            submittedAt: "2026-09-07T10:00:00.000Z",
          },
        ],
        count: 1,
        limit: 50,
      });
    });

    await page.goto("/dashboard");
    await expect(
      page.getByTestId("feedback-controls-inc-feedback-1"),
    ).toBeVisible();
    await expect.poll(() => investigateCalls).toBeGreaterThanOrEqual(1);

    await page.getByTestId("feedback-button-confirmed-inc-feedback-1").click();

    await expect(
      page.getByTestId("feedback-row-f_e2e_1"),
    ).toBeVisible();

    expect(feedbackPosts).toEqual([
      { runId: "r_fixture", versionId: "v_init", label: "confirmed" },
    ]);
  });

  test("surfaces a 404 from the feedback API as inline error text", async ({
    page,
  }) => {
    await mockSessionAndConnectors(page);

    await page.route("**/api/incidents", (route) =>
      fulfillJson(route, { incidents: [INCIDENT], count: 1 }),
    );

    await page.route(
      "**/api/incidents/inc-feedback-1/investigate",
      (route) => fulfillJson(route, INVESTIGATE_RESPONSE, 201),
    );

    await page.route("**/api/investigations/r_fixture/feedbacks", (route) =>
      fulfillJson(route, {
        runId: "r_fixture",
        status: "pending",
        requestedAt: "2026-09-07T09:00:00.000Z",
        feedbacks: [],
        count: 0,
        limit: 50,
      }),
    );

    await page.route(
      "**/api/investigations/*/versions/*/feedback",
      (route) =>
        fulfillJson(
          route,
          { error: "investigationFeedbackId not found in this tenant" },
          404,
        ),
    );

    await page.goto("/dashboard");
    await expect(
      page.getByTestId("feedback-button-incorrect-inc-feedback-1"),
    ).toBeVisible();

    await page.getByTestId("feedback-button-incorrect-inc-feedback-1").click();

    await expect(
      page.getByTestId("feedback-error-inc-feedback-1"),
    ).toContainText(/not found in this tenant/);
  });
});
