import { test, expect } from '@playwright/test';

const user = {
  id: 'user-onboarding',
  email: 'owner@new-isp.test',
  name: 'Owner',
  role: 'OWNER',
  tenantId: 'tenant-new',
  tenant: { id: 'tenant-new', name: 'Nuevo ISP', slug: 'nuevo-isp' },
};

test('onboarding only completes after a successful NMS test', async ({ page }) => {
  const connectors: Array<Record<string, unknown>> = [];
  let testSucceeds = false;

  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user } }));
  await page.route('**/api/connectors', (route) =>
    route.fulfill({ json: { connectors } }),
  );
  await page.route('**/api/connectors/create', async (route) => {
    const body = route.request().postDataJSON();
    const connector = {
      id: 'conn-new',
      provider: body.provider,
      label: body.label,
      baseUrl: body.baseUrl,
      status: 'pending',
      lastCheckedAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    connectors.push(connector);
    return route.fulfill({ status: 201, json: { connector } });
  });
  await page.route('**/api/connectors/*/test', (route) => {
    const connector = connectors[0];
    if (connector) connector.status = testSucceeds ? 'connected' : 'error';
    return route.fulfill({
      json: testSucceeds
        ? { ok: true }
        : { ok: false, error: 'Credenciales inválidas' },
    });
  });
  await page.route('**/api/alerts**', (route) =>
    route.fulfill({ json: { alerts: [], count: 0, dataSource: null } }),
  );
  await page.route('**/api/users', (route) =>
    route.fulfill({ json: { users: [user] } }),
  );
  await page.route('**/api/conversations**', (route) =>
    route.fulfill({ json: { conversations: [] } }),
  );

  await page.goto('/app');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByLabel('Clave de API').fill('invalid-key');
  await page.getByRole('button', { name: 'Guardar y probar' }).click();

  await expect(page.getByText('La conexión falló.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  await expect(page.getByText('¡Listo! Tu red quedó conectada.')).toHaveCount(0);

  testSucceeds = true;
  await page.getByRole('button', { name: 'Volver a probar' }).click();
  await expect(page.getByText('Conexión exitosa.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('¡Listo! Tu red quedó conectada.')).toBeVisible();
});
