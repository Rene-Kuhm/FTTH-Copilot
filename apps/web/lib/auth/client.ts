'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ClientRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: ClientRole;
  tenantId: string;
  mfaEnabled: boolean;
  tenant: { id: string; name: string; slug: string };
}

export type LoginResult =
  | { status: 'ok' }
  | { status: 'mfa_required'; tempToken: string }
  | { status: 'mfa_setup_required'; tempToken: string; error: string };

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResult>;
  signup: (
    email: string,
    password: string,
    name: string,
    tenantName: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function errorFromResponse(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => ({}));
  return new Error(typeof body.error === 'string' ? body.error : fallback);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function loginRequest(email: string, password: string): Promise<LoginResult> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (response.ok && body.mfaRequired === true) {
    const tempToken = readString(body.tempToken);
    if (tempToken) {
      return { status: 'mfa_required', tempToken };
    }
  }

  if (response.status === 403 && body.mfaSetupRequired === true) {
    const tempToken = readString(body.tempToken);
    return {
      status: 'mfa_setup_required',
      tempToken: tempToken ?? '',
      error: readString(body.error) ?? 'La política de la organización exige configurar MFA antes de ingresar.',
    };
  }

  if (!response.ok) {
    throw new Error(readString(body.error) ?? 'No se pudo iniciar sesión.');
  }

  return { status: 'ok' };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (!response.ok) {
        throw await errorFromResponse(response, 'No se pudo cargar la sesión.');
      }
      const data = (await response.json()) as { user?: SessionUser | null };
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const result = await loginRequest(email, password);
      if (result.status === 'ok') {
        await refresh();
      }
      return result;
    },
    [refresh],
  );

  const signup = useCallback(
    async (email: string, password: string, name: string, tenantName: string) => {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, name, tenantName }),
      });
      if (!response.ok) {
        throw await errorFromResponse(response, 'No se pudo crear la cuenta.');
      }
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      throw await errorFromResponse(response, 'No se pudo cerrar la sesión.');
    }
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, refresh, login, signup, logout }),
    [user, loading, refresh, login, signup, logout],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return context;
}
