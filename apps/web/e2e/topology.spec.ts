import { expect, test } from '@playwright/test';

/**
 * Fase E-7.2 — Playwright E2E for the `<TopologyImpact>` subcomponent on
 * `apps/web/components/IncidentsPanel.tsx`. Verifies the role-divergent
 * rendering:
 *   - OWNER sees the expandable "Análisis de impacto" accordion with the
 *     full downstream ONU list when expanded.
 *   - OPERATOR sees the compact "Resumen" line ("1 OLT, 3 ONUs afectadas").
 *   - Both roles see the snapshot-locked empty-state message when the
 *     downstream fetch returns `onuIds: []`.
 *
 * The role switch is achieved by mocking the `/api/auth/me` payload per
 * test — we don't depend on a live backend or fixtures. The
 * `/api/topology/downstream` response is mocked with `page.route()` so the
 * test stays self-contained and deterministic.
 */
test.describe('TopologyImpact — OWNER/ADMIN vs OPERATOR/MEMBER rendering', () => {
  test.beforeEach(async ({ page }) => {
    // Default mock: an OWNER user with the topology route returning
    // 3 downstream ONUs. Each test overrides as needed.
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'user-1',
            email: 'owner@isp.com',
            name: 'Owner',
            role: 'OWNER',
            tenantId: 'tenant-1',
            tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
          },
        }),
      });
    });
    await page.route('**/api/topology/downstream**', async (route) => {
      const url = new URL(route.request().url());
      const kind = url.searchParams.get('kind') ?? 'OLT';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema: 'ftth.topology.v1',
          kind,
          id: 'OLT-1',
          onuIds: ['ONU-1', 'ONU-2', 'ONU-3'],
          edgesTraversed: 3,
        }),
      });
    });
    await page.route('**/api/incidents', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          incidents: [
            {
              id: 'inc-1',
              deviceKind: 'OLT',
              deviceId: 'OLT-1',
              title: 'OLT-1 caída de RX',
              description: 'Pérdida de RX en cascada',
              severity: 'critical',
              status: 'open',
              firstSeenAt: '2026-09-03T18:00:00.000Z',
              lastSeenAt: '2026-09-03T18:00:00.000Z',
              alertCount: 3,
            },
          ],
          count: 1,
        }),
      });
    });
  });

  test('OWNER sees the expandable "Análisis de impacto" accordion with the full ONU list', async ({ page }) => {
    await page.goto('/');
    const accordion = page.getByTestId('topology-impact-accordion');
    await expect(accordion).toBeVisible();
    await expect(accordion).toContainText('Análisis de impacto');
    await accordion.getByTestId('topology-impact-toggle').click();
    const list = accordion.getByTestId('topology-impact-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText('ONU-1');
    await expect(list).toContainText('ONU-2');
    await expect(list).toContainText('ONU-3');
  });

  test('OPERATOR sees the compact "Resumen" line, no accordion', async ({ page }) => {
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'user-2',
            email: 'ops@isp.com',
            name: 'Ops',
            role: 'OPERATOR',
            tenantId: 'tenant-1',
            tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
          },
        }),
      });
    });
    await page.goto('/');
    const compact = page.getByTestId('topology-impact-compact');
    await expect(compact).toBeVisible();
    await expect(compact).toContainText('Resumen');
    await expect(compact).toContainText('3 ONUs afectadas');
    // The accordion is NOT rendered for OPERATOR/MEMBER.
    await expect(page.getByTestId('topology-impact-accordion')).toHaveCount(0);
  });

  test('empty downstream (onuIds: []) shows the snapshot-locked empty message for both roles', async ({ page }) => {
    await page.route('**/api/topology/downstream**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema: 'ftth.topology.v1',
          kind: 'OLT',
          id: 'OLT-1',
          onuIds: [],
          edgesTraversed: 0,
        }),
      });
    });
    // OWNER first.
    await page.goto('/');
    const accordion = page.getByTestId('topology-impact-accordion');
    await accordion.getByTestId('topology-impact-toggle').click();
    await expect(page.getByTestId('topology-impact-empty')).toContainText(
      'No hay datos de topología para este dispositivo.',
    );

    // Now switch to OPERATOR — the compact path renders the same empty text.
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'user-2',
            email: 'ops@isp.com',
            name: 'Ops',
            role: 'OPERATOR',
            tenantId: 'tenant-1',
            tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
          },
        }),
      });
    });
    await page.goto('/');
    const compact = page.getByTestId('topology-impact-compact');
    await expect(compact).toContainText(
      'No hay datos de topología para este dispositivo.',
    );
  });
});