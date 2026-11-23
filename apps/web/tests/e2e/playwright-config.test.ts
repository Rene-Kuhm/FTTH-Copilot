/**
 * El puerto de los E2E tiene que poder moverse: varios agentes corren suites
 * distintas a la vez y el 3001 suele estar ocupado. El default sigue siendo
 * 3001 para no romper el CI actual.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig(env: Record<string, string | undefined>) {
  const previous = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    const mod = await import('../../playwright.config');
    const config = mod.default;
    const webServer = Array.isArray(config.webServer)
      ? config.webServer[0]
      : config.webServer;
    return { port: webServer?.port, baseURL: config.use?.baseURL };
  } finally {
    process.env = previous;
  }
}

describe('playwright.config — puerto configurable', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('usa el puerto 3001 por defecto', async () => {
    const config = await loadConfig({
      PLAYWRIGHT_PORT: undefined,
      PLAYWRIGHT_BASE_URL: undefined,
    });

    expect(config.port).toBe(3001);
    expect(config.baseURL).toBe('http://localhost:3001');
  });

  it('respeta PLAYWRIGHT_PORT y PLAYWRIGHT_BASE_URL', async () => {
    const config = await loadConfig({
      PLAYWRIGHT_PORT: '3531',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:3531',
    });

    expect(config.port).toBe(3531);
    expect(config.baseURL).toBe('http://127.0.0.1:3531');
  });
});
