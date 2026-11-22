'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { ThemeToggle } from './ThemeToggle';
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
  oidcEnabled?: boolean;
  initialOidcError?: string | null;
  initialMfaTempToken?: string | null;
}

const OIDC_ERROR_MESSAGES: Record<string, string> = {
  oidc_missing_state: 'La sesión SSO expiró o falta el estado de verificación. Probá de nuevo.',
  oidc_invalid_state: 'El estado de verificación SSO es inválido o expiró. Probá de nuevo.',
  oidc_callback_failed: 'No se pudo completar la autenticación con el proveedor SSO.',
  oidc_discovery_failed: 'No se pudo contactar al proveedor SSO.',
  oidc_missing_id_token: 'El proveedor SSO no devolvió un token de identidad.',
  oidc_invalid_issuer: 'El emisor del token SSO no coincide con la configuración.',
  oidc_invalid_audience: 'La audiencia del token SSO no coincide con la aplicación.',
  oidc_token_expired: 'El token SSO expiró. Probá de nuevo.',
  oidc_invalid_nonce: 'Falló la validación de seguridad (nonce) del token SSO.',
  oidc_tenant_not_found: 'No se encontró el tenant configurado para SSO.',
  oidc_tenant_mismatch: 'Tu identidad SSO pertenece a otro tenant.',
  oidc_missing_email: 'Tu proveedor SSO no devolvió un email.',
  oidc_email_not_verified: 'Tu email en el proveedor SSO no está verificado.',
  oidc_domain_not_allowed: 'El dominio de tu email no está autorizado para ingresar por SSO.',
  oidc_user_not_found: 'No existe un usuario habilitado para este email en el tenant.',
  oidc_provision_conflict: 'No se pudo aprovisionar el usuario por conflicto con otro tenant.',
};

export function AuthBar({
  initialMode = null,
  oidcEnabled = false,
  initialOidcError = null,
  initialMfaTempToken = null,
}: AuthBarProps) {
  const auth = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | null>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [mfaTempToken, setMfaTempToken] = useState<string | null>(initialMfaTempToken);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);
  const [mfaSetupSecret, setMfaSetupSecret] = useState<string | null>(null);
  const [mfaSetupUri, setMfaSetupUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    initialOidcError
      ? (OIDC_ERROR_MESSAGES[initialOidcError] ?? 'No se pudo iniciar sesión con SSO.')
      : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const mfaCodeInputRef = useRef<HTMLInputElement | null>(null);
  const showMfaStep = !auth.loading && !auth.user && Boolean(mfaTempToken);

  useEffect(() => {
    if (showMfaStep) {
      mfaCodeInputRef.current?.focus();
    }
  }, [showMfaStep, mfaTempToken]);

  if (auth.loading) {
    return (
      <div className="card h-[74px] animate-pulse" role="status">
        <span className="sr-only">Cargando sesión…</span>
      </div>
    );
  }

  if (auth.user) {
    return (
      <div
        className="card flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5"
        style={{ color: 'var(--color-text)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{
              border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
              background: 'rgb(242 48 119 / 0.1)',
              color: 'var(--color-accent)',
            }}
          >
            <UserCircleIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="truncate text-sm font-semibold"
                style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}
              >
                {auth.user.email}
              </span>
              <span
                className="badge"
                style={{
                  background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                  color: 'var(--color-success)',
                  border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
                  fontFamily: 'var(--font-display)',
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--color-success)' }}
                />
                Activa
              </span>
            </div>
            <div
              className="mt-1 flex items-center gap-1.5 text-[11px]"
              style={{ color: 'var(--color-muted)' }}
            >
              <BuildingOfficeIcon className="h-3.5 w-3.5" />
              <span className="truncate">{auth.user.tenant.name}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              setError(null);
              void auth.logout().catch((caught) =>
                setError(
                  caught instanceof Error ? caught.message : 'No se pudo cerrar la sesión.',
                ),
              );
            }}
            className="btn-ghost px-3"
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4" />
            Salir
          </button>
        </div>
      </div>
    );
  }

  if (mode === null) {
    return (
      <div
        className="card flex flex-col items-start justify-between gap-5 px-5 py-5 sm:flex-row sm:items-center sm:px-6"
        style={{ color: 'var(--color-text)' }}
      >
        <div>
          <h2
            className="text-base font-semibold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
          >
            Inicia sesión
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
            Accedé para chatear con tu red FTTH y gestionar tu tenant.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode('login')} className="btn-outline">
            <ArrowLeftOnRectangleIcon className="h-4 w-4" />
            Iniciar sesión
          </button>
          <button type="button" onClick={() => setMode('signup')} className="btn-primary">
            Crear cuenta
          </button>
        </div>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMfaSetupRequired(false);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        const result = await auth.login(email, password);
        if (result.status === 'mfa_required') {
          setMfaTempToken(result.tempToken);
          setMfaCode('');
          return;
        }
        if (result.status === 'mfa_setup_required') {
          setMfaTempToken(result.tempToken);
          setMfaCode('');
          setMfaSetupRequired(true);
          setMfaSetupSecret(null);
          setMfaSetupUri(null);
          setError(result.error);
          return;
        }
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

  async function beginMfaSetup() {
    if (!mfaTempToken) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/mfa/setup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${mfaTempToken}` },
        credentials: 'include',
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'No se pudo iniciar la configuración MFA.',
        );
      }
      setMfaSetupSecret(typeof body.secret === 'string' ? body.secret : null);
      setMfaSetupUri(typeof body.otpauthUri === 'string' ? body.otpauthUri : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaTempToken) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tempToken: mfaTempToken, code: mfaCode }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const message =
          typeof body.error === 'string' ? body.error : 'No se pudo verificar el código MFA.';
        if (res.status === 429) {
          const retryAfter = res.headers.get('retry-after');
          const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
          if (Number.isFinite(seconds) && seconds > 0) {
            throw new Error(`${message} Intentá de nuevo en ${seconds} segundos.`);
          }
        }
        throw new Error(message);
      }
      setMfaTempToken(null);
      setMfaCode('');
      setMfaSetupRequired(false);
      setMfaSetupSecret(null);
      setMfaSetupUri(null);
      await auth.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  if (mfaTempToken) {
    return (
      <form
        onSubmit={(e) => void submitMfa(e)}
        className="card space-y-5 p-5 sm:p-6"
        style={{ color: 'var(--color-text)' }}
      >
        <div>
          <h2
            className="text-lg font-semibold tracking-[-0.02em]"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
          >
            Verificación en dos pasos
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
            {mfaSetupRequired
              ? 'Tu organización exige MFA. Generá un secreto TOTP, configurá tu app autenticadora y verificá el código para completar el ingreso.'
              : 'Ingresá el código de 6 dígitos de tu app autenticadora.'}
          </p>
        </div>
        {mfaSetupRequired && !mfaSetupSecret && (
          <button
            type="button"
            onClick={() => void beginMfaSetup()}
            disabled={submitting}
            className="btn-outline min-h-11 w-full"
          >
            Generar configuración MFA
          </button>
        )}
        {mfaSetupRequired && mfaSetupSecret && (
          <div
            className="rounded-lg px-3 py-3 text-sm space-y-2"
            style={{
              border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
              background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
              color: 'var(--color-text)',
            }}
          >
            <p style={{ color: 'var(--color-muted)' }}>
              Agregá esta clave en tu app autenticadora y luego ingresá el código.
            </p>
            <p className="font-mono text-xs break-all">
              <span style={{ color: 'var(--color-muted)' }}>Secreto: </span>
              {mfaSetupSecret}
            </p>
            {mfaSetupUri && (
              <p className="text-xs break-all" style={{ color: 'var(--color-muted)' }}>
                URI: <span className="font-mono">{mfaSetupUri}</span>
              </p>
            )}
          </div>
        )}
        <Field icon={<KeyIcon className="h-4 w-4" />} label="Código TOTP">
          <input
            ref={mfaCodeInputRef}
            type="text"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            required
            className="input"
            aria-describedby={error ? 'mfa-error' : undefined}
          />
        </Field>
        {error && (
          <div
            id="mfa-error"
            role="alert"
            aria-live="assertive"
            className="rounded-lg px-3 py-2 text-sm"
            style={{
              border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)',
              background: 'color-mix(in srgb, var(--color-danger) 10%, transparent)',
              color: 'var(--color-danger)',
            }}
          >
            {error}
          </div>
        )}
        <button type="submit" disabled={submitting} className="btn-primary min-h-11 w-full">
          <KeyIcon className="h-4 w-4" />
          {submitting ? 'Verificando…' : 'Verificar'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMfaTempToken(null);
            setMfaCode('');
            setMfaSetupRequired(false);
            setMfaSetupSecret(null);
            setMfaSetupUri(null);
            setError(null);
          }}
          className="btn-ghost w-full"
        >
          Volver al inicio de sesión
        </button>
      </form>
    );
  }

  const isLogin = mode === 'login';

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="card space-y-5 p-5 sm:p-6"
      style={{ color: 'var(--color-text)' }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-lg font-semibold tracking-[-0.02em]"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
          >
            {isLogin ? 'Iniciar sesión' : 'Crear cuenta'}
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
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
            <Field icon={<UserCircleIcon className="h-4 w-4" />} label="Tu nombre">
              <input
                type="text"
                name="name"
                autoComplete="name"
                placeholder="Tu nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="input"
              />
            </Field>
            <Field
              icon={<BuildingOfficeIcon className="h-4 w-4" />}
              label="Nombre de tu ISP/empresa"
            >
              <input
                type="text"
                name="organization"
                autoComplete="organization"
                placeholder="Nombre de tu ISP/empresa"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                required
                className="input"
              />
            </Field>
          </>
        )}
        <Field icon={<EnvelopeIcon className="h-4 w-4" />} label="Email">
          <input
            type="email"
            name="email"
            autoComplete="email"
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
            name="password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
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
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg px-3 py-2 text-sm"
          style={{
            border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)',
            background: 'color-mix(in srgb, var(--color-danger) 10%, transparent)',
            color: 'var(--color-danger)',
          }}
        >
          {error}
        </div>
      )}

      <button type="submit" disabled={submitting} className="btn-primary min-h-11 w-full">
        <KeyIcon className="h-4 w-4" />
        {submitting ? 'Enviando…' : isLogin ? 'Entrar' : 'Crear cuenta'}
      </button>

      {isLogin && oidcEnabled && (
        <div className="pt-1">
          <a
            href="/api/auth/oidc/login"
            className="btn-outline inline-flex min-h-11 w-full items-center justify-center gap-2"
          >
            <ArrowLeftOnRectangleIcon className="h-4 w-4" />
            Ingresar con SSO
          </a>
        </div>
      )}
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
      <span
        className="flex items-center justify-between text-xs font-medium"
        style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}
      >
        <span className="inline-flex items-center gap-1.5">
          <span style={{ color: 'var(--color-muted)', opacity: 0.7 }}>{icon}</span>
          {label}
        </span>
        {hint && <span style={{ opacity: 0.6 }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}
