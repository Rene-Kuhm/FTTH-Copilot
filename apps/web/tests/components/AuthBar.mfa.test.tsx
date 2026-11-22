// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthBar } from '../../components/AuthBar';

const authMocks = vi.hoisted(() => ({
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock('@/lib/auth/client', () => ({
  useAuth: () => authMocks.useAuth(),
}));

function renderAuthBar() {
  authMocks.useAuth.mockReturnValue({
    user: null,
    loading: false,
    login: authMocks.login,
    signup: authMocks.signup,
    logout: authMocks.logout,
    refresh: authMocks.refresh,
  });
  return render(<AuthBar initialMode="login" />);
}

describe('AuthBar MFA challenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('muestra el paso TOTP cuando login requiere MFA y completa la verificación', async () => {
    authMocks.login.mockResolvedValue({ status: 'mfa_required', tempToken: 'temp-123' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: 'u1' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAuthBar();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await screen.findByText('Verificación en dos pasos');
    const codeInput = screen.getByLabelText(/código totp/i) as HTMLInputElement;
    expect(codeInput.getAttribute('inputmode')).toBe('numeric');
    expect(codeInput.getAttribute('autocomplete')).toBe('one-time-code');

    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/mfa/verify', expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }));
    });
    const verifyCall = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/mfa/verify');
    expect(verifyCall).toBeTruthy();
    expect(JSON.parse((verifyCall?.[1] as RequestInit).body as string)).toEqual({
      tempToken: 'temp-123',
      code: '123456',
    });
    expect(authMocks.refresh).toHaveBeenCalled();
  });

  it('muestra error claro ante 429 con Retry-After', async () => {
    authMocks.login.mockResolvedValue({ status: 'mfa_required', tempToken: 'temp-123' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '30' }),
      json: async () => ({ error: 'Demasiados intentos. Probá de nuevo más tarde.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAuthBar();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByText('Verificación en dos pasos');

    fireEvent.change(screen.getByLabelText(/código totp/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('30');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('muestra mensaje mínimo cuando la política exige enrolamiento MFA', async () => {
    authMocks.login.mockResolvedValue({
      status: 'mfa_setup_required',
      tempToken: 'temp-setup',
      error: 'MFA is required by your organization policy. Configure TOTP before signing in.',
    });

    renderAuthBar();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/MFA|configurar|organización/i);
  });

  it('enfoca el campo de código TOTP al aparecer el paso MFA y no roba el foco después', async () => {
    authMocks.login.mockResolvedValue({ status: 'mfa_required', tempToken: 'temp-123' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Código inválido' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAuthBar();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await screen.findByText('Verificación en dos pasos');
    const codeInput = screen.getByLabelText(/código totp/i);
    await waitFor(() => {
      expect(document.activeElement).toBe(codeInput);
    });

    const verifyButton = screen.getByRole('button', { name: 'Verificar' });
    verifyButton.focus();
    expect(document.activeElement).toBe(verifyButton);

    fireEvent.change(codeInput, { target: { value: '000000' } });
    fireEvent.click(verifyButton);
    await screen.findByRole('alert');

    expect(document.activeElement).toBe(verifyButton);
  });
});
