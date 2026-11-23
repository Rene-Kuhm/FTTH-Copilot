import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

const password = 'Synthetic-Audit-Password-2026';
const runId = randomUUID();
const email = (label: string) => `${label}-${runId}@synthetic.test`;
const alphaEmail = email('alpha');
const betaEmail = email('beta');
const operatorEmail = email('operator');

let alpha: APIRequestContext;
let beta: APIRequestContext;
let operator: APIRequestContext;
let alphaHeaders: Record<string, string>;

async function csrfHeaders(client: APIRequestContext) {
  const { cookies } = await client.storageState();
  const token = cookies.find((cookie) => cookie.name === 'ftth_csrf')?.value;
  if (!token) throw new Error('La sesión sintética no recibió la cookie ftth_csrf');
  return { 'x-csrf-token': token };
}

test.beforeAll(async ({ playwright, baseURL }) => {
  alpha = await playwright.request.newContext({ baseURL, maxRedirects: 0 });
  beta = await playwright.request.newContext({ baseURL, maxRedirects: 0 });
  operator = await playwright.request.newContext({ baseURL, maxRedirects: 0 });

  for (const [client, ownerEmail, tenantName] of [
    [alpha, alphaEmail, 'Fibra Sintética Alfa'],
    [beta, betaEmail, 'Fibra Sintética Beta'],
  ] as const) {
    const response = await client.post('/api/auth/signup', {
      data: { email: ownerEmail, password, tenantName },
    });
    expect(response.status()).toBe(201);
  }

  alphaHeaders = await csrfHeaders(alpha);
  const created = await alpha.post('/api/users', {
    headers: alphaHeaders,
    data: { email: operatorEmail, password, role: 'OPERATOR' },
  });
  expect(created.status()).toBe(201);
  const login = await operator.post('/api/auth/login', {
    data: { email: operatorEmail, password },
  });
  expect(login.status()).toBe(200);
});

test.afterAll(async () => {
  await Promise.all([alpha?.dispose(), beta?.dispose(), operator?.dispose()]);
});

test('la lista de usuarios se limita al tenant de la sesión', async () => {
  const alphaList = await alpha.get('/api/users');
  const betaList = await beta.get('/api/users');
  expect(alphaList.status()).toBe(200);
  expect(betaList.status()).toBe(200);
  const { users: alphaUsers } = await alphaList.json();
  const { users: betaUsers } = await betaList.json();
  expect(alphaUsers.map((user: { email: string }) => user.email).sort()).toEqual(
    [alphaEmail, operatorEmail].sort(),
  );
  expect(betaUsers.map((user: { email: string }) => user.email)).toEqual([betaEmail]);
});

test('gestión de usuarios requiere sesión y permiso', async ({ request }) => {
  expect((await request.get('/api/users', { maxRedirects: 0 })).status()).toBe(401);
  expect((await operator.get('/api/users')).status()).toBe(403);
  const response = await operator.post('/api/users', {
    headers: await csrfHeaders(operator),
    data: { email: email('new-user'), password, role: 'OPERATOR' },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({ error: 'Insufficient permissions' });
});

test('la mutación comprueba CSRF antes de validar el cuerpo', async () => {
  const missingHeader = await alpha.post('/api/users', { data: {} });
  expect(missingHeader.status()).toBe(403);
  expect(await missingHeader.json()).toEqual({ error: 'Invalid CSRF token' });

  const invalidBody = await alpha.post('/api/users', { headers: alphaHeaders, data: {} });
  expect(invalidBody.status()).toBe(400);
  expect(await invalidBody.json()).toMatchObject({ error: 'Invalid input' });
});

test('la respuesta autenticada incluye cabeceras de seguridad', async () => {
  const response = await alpha.get('/api/users');
  expect(response.status()).toBe(200);
  expect(response.headers()).toMatchObject({
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
  });
  expect(response.headers()['content-security-policy']).toContain("default-src 'self'");
});

test('login aplica la cuota configurada y devuelve Retry-After', async ({ request }) => {
  const data = { email: email('quota'), password };
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request.post('/api/auth/login', { data, maxRedirects: 0 });
    expect(response.status()).toBe(401);
  }

  const limited = await request.post('/api/auth/login', { data, maxRedirects: 0 });
  expect(limited.status()).toBe(429);
  expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0);
});

test('alta de conector aplica la allowlist de la política SSRF', async () => {
  const response = await alpha.post('/api/connectors/create', {
    headers: alphaHeaders,
    data: {
      provider: 'SMARTOLT',
      label: 'NMS de documentación',
      apiKey: 'synthetic-key',
      baseUrl: 'https://192.0.2.10',
    },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining('NMS_ALLOWED_HOSTS') });
});
