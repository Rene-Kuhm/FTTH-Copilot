import { expect, test } from '@playwright/test';

const user = {
  id: 'user-without-nms',
  email: 'owner@isp.test',
  name: 'Owner',
  role: 'OWNER',
  tenantId: 'tenant-without-nms',
  tenant: { id: 'tenant-without-nms', name: 'ISP', slug: 'isp' },
};

test('chat guides the user to setup instead of sending without a validated NMS', async ({
  page,
}) => {
  let chatRequests = 0;

  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user } }));
  await page.route('**/api/connectors', (route) =>
    route.fulfill({ json: { connectors: [], demoMode: false } }),
  );
  await page.route('**/api/chat', (route) => {
    chatRequests += 1;
    return route.fulfill({ status: 409, json: { error: 'No hay un conector NMS validado.' } });
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

  await expect(page.getByText('Conectá tu NMS para comenzar')).toBeVisible();
  await expect(page.getByLabel('Pregunta para el Copilot')).toBeDisabled();
  await expect(page.getByText('No hay un conector NMS validado.')).toHaveCount(0);

  await page.getByRole('link', { name: 'Configurar conector NMS' }).click();
  await expect(page.getByRole('heading', { name: 'Conectores NMS' })).toBeVisible();
  expect(chatRequests).toBe(0);
});
