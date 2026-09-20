import { afterEach, describe, expect, it, vi } from 'vitest';

describe('session cookie security', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps cookies secure by default in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const { sessionCookieAttributes } = await import('../src/cookies');

    expect(sessionCookieAttributes().secure).toBe(true);
  });

  it('allows the local desktop HTTP runtime to opt out explicitly', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');

    const { sessionCookieAttributes } = await import('../src/cookies');

    expect(sessionCookieAttributes().secure).toBe(false);
  });

  it('allows HTTPS deployments to force Secure cookies explicitly', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');

    const { sessionCookieAttributes } = await import('../src/cookies');

    expect(sessionCookieAttributes().secure).toBe(true);
  });
});
