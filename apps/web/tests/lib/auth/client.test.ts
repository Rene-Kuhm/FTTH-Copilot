import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('auth client login', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('devuelve mfa_required cuando el servidor pide desafío MFA', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ mfaRequired: true, tempToken: 'temp-123' }),
    }) as unknown as typeof fetch;

    const { loginRequest } = await import('@/lib/auth/client');
    const result = await loginRequest('user@example.com', 'password123');

    expect(result).toEqual({ status: 'mfa_required', tempToken: 'temp-123' });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
  });

  it('devuelve mfa_setup_required cuando el tenant exige enrolamiento', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'MFA is required by your organization policy. Configure TOTP before signing in.',
        code: 'MFA_SETUP_REQUIRED',
        mfaSetupRequired: true,
        tempToken: 'temp-setup',
      }),
    }) as unknown as typeof fetch;

    const { loginRequest } = await import('@/lib/auth/client');
    const result = await loginRequest('user@example.com', 'password123');

    expect(result).toEqual({
      status: 'mfa_setup_required',
      tempToken: 'temp-setup',
      error: 'MFA is required by your organization policy. Configure TOTP before signing in.',
    });
  });

  it('devuelve ok cuando el login completa sin MFA', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: 'u1' } }),
    }) as unknown as typeof fetch;

    const { loginRequest } = await import('@/lib/auth/client');
    const result = await loginRequest('user@example.com', 'password123');

    expect(result).toEqual({ status: 'ok' });
  });

  it('lanza error en credenciales inválidas', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid credentials' }),
    }) as unknown as typeof fetch;

    const { loginRequest } = await import('@/lib/auth/client');
    await expect(loginRequest('user@example.com', 'bad')).rejects.toThrow('Invalid credentials');
  });

  it('incluye el tiempo de reintento cuando 429 trae retry-after positivo', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '42' }),
      json: async () => ({ error: 'Demasiados intentos. Probá de nuevo más tarde.' }),
    }) as unknown as typeof fetch;

    const { loginRequest } = await import('@/lib/auth/client');
    await expect(loginRequest('user@example.com', 'bad')).rejects.toThrow(
      'Demasiados intentos. Probá de nuevo más tarde. Intentá de nuevo en 42 segundos.',
    );
  });

  it('lanza error cuando mfaRequired es true pero falta tempToken', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ mfaRequired: true }),
    }) as unknown as typeof fetch;

    const { loginRequest } = await import('@/lib/auth/client');
    await expect(loginRequest('user@example.com', 'password123')).rejects.toThrow(/token/i);
  });

  it('conserva solo el mensaje del servidor cuando 429 no trae retry-after', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers(),
      json: async () => ({ error: 'Demasiados intentos. Probá de nuevo más tarde.' }),
    }) as unknown as typeof fetch;

    const { loginRequest } = await import('@/lib/auth/client');
    await expect(loginRequest('user@example.com', 'bad')).rejects.toThrow(
      /^Demasiados intentos\. Probá de nuevo más tarde\.$/,
    );
  });
});

describe('auth client MFA verification & setup', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('envía tempToken y código TOTP a /api/auth/mfa/verify', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: 'u1' } }),
    }) as unknown as typeof fetch;

    const { verifyMfaRequest } = await import('@/lib/auth/client');
    await expect(verifyMfaRequest('temp-123', '123456')).resolves.toBeUndefined();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/auth/mfa/verify',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ tempToken: 'temp-123', code: '123456' }),
      }),
    );
  });

  it('propaga error del servidor y retry-after en verifyMfaRequest', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '30' }),
      json: async () => ({ error: 'Demasiados intentos. Probá de nuevo más tarde.' }),
    }) as unknown as typeof fetch;

    const { verifyMfaRequest } = await import('@/lib/auth/client');
    await expect(verifyMfaRequest('temp-123', '000000')).rejects.toThrow(
      'Demasiados intentos. Probá de nuevo más tarde. Intentá de nuevo en 30 segundos.',
    );
  });

  it('inicia enrolamiento MFA en /api/auth/mfa/setup con Bearer tempToken', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/FTTH-Copilot:user@example.com?secret=JBSWY3DPEHPK3PXP',
      }),
    }) as unknown as typeof fetch;

    const { setupMfaRequest } = await import('@/lib/auth/client');
    const result = await setupMfaRequest('temp-setup');

    expect(result).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/FTTH-Copilot:user@example.com?secret=JBSWY3DPEHPK3PXP',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/auth/mfa/setup',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: 'Bearer temp-setup' },
      }),
    );
  });
});
