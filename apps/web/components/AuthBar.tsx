'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import {
  ArrowLeftOnRectangleIcon,
  ArrowRightOnRectangleIcon,
  BuildingOfficeIcon,
  EnvelopeIcon,
  KeyIcon,
  LockClosedIcon,
  UserCircleIcon,
  XMarkIcon,
} from './icons';

interface AuthBarProps {
  initialMode?: 'login' | 'signup' | null;
}

export function AuthBar({ initialMode = null }: AuthBarProps) {
  const auth = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | null>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth.loading) {
    return (
      <div className="card px-5 py-4 text-sm text-fg-muted">Cargando sesión…</div>
    );
  }

  if (auth.user) {
    return (
      <div className="card flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent ring-1 ring-inset ring-accent/30">
            <UserCircleIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-fg">
                {auth.user.email}
              </span>
              <span className="badge bg-success/15 text-success ring-1 ring-inset ring-success/30">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Active
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-dim">
              <BuildingOfficeIcon className="h-3.5 w-3.5" />
              <span className="truncate">{auth.user.tenant.name}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void auth.logout()}
          className="btn-outline"
        >
          <ArrowRightOnRectangleIcon className="h-4 w-4" />
          Salir
        </button>
      </div>
    );
  }

  if (mode === null) {
    return (
      <div className="card flex flex-col items-start justify-between gap-4 px-5 py-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-sm font-semibold text-fg">Inicia sesión</h2>
          <p className="mt-0.5 text-xs text-fg-dim">
            Accedé para chatear con tu red FTTH y gestionar tu tenant.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode('login')}
            className="btn-outline"
          >
            <ArrowLeftOnRectangleIcon className="h-4 w-4" />
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className="btn-primary"
          >
            Crear cuenta
          </button>
        </div>
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

  const isLogin = mode === 'login';

  return (
    <form onSubmit={(e) => void submit(e)} className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-fg">
            {isLogin ? 'Iniciar sesión' : 'Crear cuenta'}
          </h2>
          <p className="mt-0.5 text-xs text-fg-dim">
            {isLogin
              ? 'Accedé a tu tenant para continuar.'
              : 'Creá tu cuenta y tenant en un solo paso.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMode(null);
            setError(null);
          }}
          className="btn-ghost px-2 py-1"
          aria-label="Cancelar"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        {!isLogin && (
          <>
            <Field
              icon={<UserCircleIcon className="h-4 w-4" />}
              label="Tu nombre"
            >
              <input
                type="text"
                placeholder="Tu nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
              />
            </Field>
            <Field
              icon={<BuildingOfficeIcon className="h-4 w-4" />}
              label="Nombre de tu ISP/empresa"
            >
              <input
                type="text"
                placeholder="Nombre de tu ISP/empresa"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                className="input"
              />
            </Field>
          </>
        )}
        <Field icon={<EnvelopeIcon className="h-4 w-4" />} label="Email">
          <input
            type="email"
            placeholder="email@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="input"
          />
        </Field>
        <Field
          icon={<LockClosedIcon className="h-4 w-4" />}
          label="Contraseña"
          hint={!isLogin ? 'Mínimo 8 caracteres' : undefined}
        >
          <input
            type="password"
            placeholder="contraseña (mín 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="input"
          />
        </Field>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full"
      >
        <KeyIcon className="h-4 w-4" />
        {submitting
          ? 'Enviando…'
          : isLogin
            ? 'Entrar'
            : 'Crear cuenta'}
      </button>
    </form>
  );
}

function Field({
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between text-xs font-medium text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-fg-dim">{icon}</span>
          {label}
        </span>
        {hint && <span className="text-fg-dim">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
