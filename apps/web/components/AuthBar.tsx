'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth/client';

export function AuthBar() {
  const auth = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth.loading) {
    return <div className="mb-4 text-sm text-fg-muted">Cargando sesión…</div>;
  }

  if (auth.user) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-md border border-neutral-800 bg-bg-subtle px-4 py-3">
        <div className="text-sm">
          <span className="text-fg-muted">Sesión activa:</span>{' '}
          <span className="font-medium">{auth.user.email}</span>{' '}
          <span className="text-xs text-fg-muted">· {auth.user.tenant.name}</span>
        </div>
        <button
          onClick={() => void auth.logout()}
          className="rounded border border-neutral-700 px-3 py-1 text-xs hover:border-red-700"
        >
          Salir
        </button>
      </div>
    );
  }

  if (mode === null) {
    return (
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setMode('login')}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-accent"
        >
          Iniciar sesión
        </button>
        <button
          onClick={() => setMode('signup')}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          Crear cuenta
        </button>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await auth.login(email, password);
      } else {
        await auth.signup(email, password, name, tenantName);
      }
      setMode(null);
      setEmail('');
      setPassword('');
      setName('');
      setTenantName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mb-4 space-y-2 rounded-md border border-neutral-800 bg-bg-subtle p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
        </h2>
        <button
          type="button"
          onClick={() => {
            setMode(null);
            setError(null);
          }}
          className="text-xs text-fg-muted hover:text-fg"
        >
          Cancelar
        </button>
      </div>
      {mode === 'signup' && (
        <>
          <input
            type="text"
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
          <input
            type="text"
            placeholder="Nombre de tu ISP/empresa"
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
        </>
      )}
      <input
        type="email"
        placeholder="email@ejemplo.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
      />
      <input
        type="password"
        placeholder="contraseña (mín 8 chars)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
        className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {submitting ? 'Enviando…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
      </button>
    </form>
  );
}
