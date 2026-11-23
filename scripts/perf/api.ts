import { randomBytes } from 'node:crypto';
import { withTenants } from './database';
import { runPhases } from './runner';
import type { Phase } from './profiles';

const origin = 'http://127.0.0.1:3301';
const pageSize = 50;
const routes = [
  { path: '/api/health?scope=container', field: null, marker: null },
  { path: `/api/predictions?limit=${pageSize}`, field: 'predictions', marker: 'deviceId' },
  { path: `/api/incidents?limit=${pageSize}`, field: 'incidents', marker: 'deviceId' },
  { path: `/api/security/access?limit=${pageSize}`, field: 'events', marker: 'message' },
] as const;

function request(path: string, init: RequestInit = {}) {
  return fetch(new URL(path, origin), { ...init, redirect: 'manual', signal: AbortSignal.timeout(5_000) });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function checkRoute(route: typeof routes[number], tenantId: string, cookie: string) {
  try {
    const response = await request(route.path, { headers: { cookie } });
    const body = await response.text();
    if (response.status !== 200) return `HTTP ${response.status}`;

    const payload: unknown = JSON.parse(body);
    if (!record(payload)) return 'invalid response';
    if (route.field === null) {
      const database = payload.database;
      if (payload.status === 'ok' && payload.scope === 'container'
        && record(database) && database.status === 'connected') return;
      return 'invalid health status';
    }
    const marker = route.marker;
    const rows = payload[route.field];
    if (!Array.isArray(rows) || rows.length !== pageSize || payload.count !== pageSize
      || !rows.every((row: unknown) => {
        if (!record(row)) return false;
        const value = row[marker];
        return typeof value === 'string' && value.startsWith(`${tenantId}:`);
      })) return 'invalid or cross-tenant page';
  } catch (error) {
    if (error instanceof SyntaxError) return 'invalid JSON';
    if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
    return 'HTTP transport error';
  }
}

export async function runApi(phases: Phase[]) {
  const health = await checkRoute(routes[0], '', '');
  if (health) throw new Error(`Next.js readiness on ${origin}: ${health}`);

  return withTenants(32, async ({ prisma, hashPassword, COOKIE_NAME }, tenantIds) => {
    const password = randomBytes(24).toString('hex');
    const passwordHash = await hashPassword(password);
    const cookies: string[] = [];
    for (const tenantId of tenantIds) {
      const email = `${tenantId}@example.test`;
      await prisma.user.create({ data: { tenantId, email, passwordHash, role: 'OWNER' } });
      const records = Array.from({ length: 128 }, (_, index) => ({
        tenantId, deviceId: `${tenantId}:ONU-${index}`, deviceKind: 'ONU' as const,
        severity: 'warning' as const, title: 'Synthetic optical degradation',
        description: 'Load-test fixture', lastSeenAt: new Date(Date.UTC(2025, 0, 1, 0, index)),
      }));
      await prisma.incident.createMany({ data: records });
      await prisma.detectedAlert.createMany({
        data: records.map((row) => ({ ...row, kind: 'predicted_low_signal' })),
      });
      await prisma.deviceEvent.createMany({
        data: records.map((row) => ({
          tenantId, sourceIp: '192.0.2.1', category: 'access', message: row.deviceId,
          occurredAt: row.lastSeenAt,
        })),
      });

      const login = await request('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      await login.text();
      const token = login.headers.get('set-cookie')?.match(new RegExp(`(?:^|,\\s*)${COOKIE_NAME}=([^;]+)`));
      if (login.status !== 200 || !token) throw new Error(`Fixture login failed (HTTP ${login.status})`);
      cookies.push(`${COOKIE_NAME}=${token[1]}`);
    }

    // Warm each route with every session and validate the fixture before timing.
    for (const [index, tenantId] of tenantIds.entries()) {
      for (const route of routes) {
        const error = await checkRoute(route, tenantId, cookies[index]);
        if (error) throw new Error(`API warm-up failed at ${route.path}: ${error}`);
      }
    }
    return runPhases(phases, routes.map(({ path }) => path), 128, (index) => {
      const tenant = Math.floor(index / routes.length) % tenantIds.length;
      return checkRoute(routes[index % routes.length], tenantIds[tenant], cookies[tenant]);
    });
  });
}
