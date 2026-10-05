'use client';

import { useState } from 'react';

/** Current UI phase of the MFA panel */
type Phase =
  | 'idle'
  | 'show-secret'
  | 'success'
  | 'error'
  | 'disabled';

/** Async sub-state for button labels and disabled state */
type LoadState = 'idle' | 'loading' | 'verifying' | 'disabling';

interface SetupData {
  secret: string;
  otpauthUrl: string;
}

interface MfaSetupPanelProps {
  mfaEnabled: boolean;
  userId: string;
}

/**
 * MFA TOTP Setup Panel
 *
 * Flows:
 * 1. Enable: idle → loading → show-secret → verifying → success
 * 2. Disable: idle → disabling → disabled
 */
export function MfaSetupPanel({ mfaEnabled, userId: _userId }: MfaSetupPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [load, setLoad] = useState<LoadState>('idle');
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Enable flow ────────────────────────────────────────────────

  async function startSetup() {
    setError(null);
    setLoad('loading');
    try {
      const res = await fetch('/api/auth/mfa/setup', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Error al iniciar configuración MFA');
      }
      const data = await res.json();
      setSetupData({ secret: data.secret, otpauthUrl: data.otpauthUrl });
      setPhase('show-secret');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setPhase('error');
    } finally {
      setLoad('idle');
    }
  }

  async function verifySetup() {
    if (code.length < 6) {
      setError('Ingresá un código de 6 dígitos');
      return;
    }
    setError(null);
    setLoad('verifying');
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Código incorrecto');
      }
      setPhase('success');
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setPhase('error');
    } finally {
      setLoad('idle');
    }
  }

  // ── Disable flow ───────────────────────────────────────────────

  async function disableMfa() {
    if (disableCode.length < 6) {
      setError('Ingresá un código de 6 dígitos');
      return;
    }
    setError(null);
    setLoad('disabling');
    try {
      const res = await fetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: disableCode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Código incorrecto');
      }
      setPhase('disabled');
      setDisableCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setPhase('error');
    } finally {
      setLoad('idle');
    }
  }

  // ── Copy secret ────────────────────────────────────────────────

  async function copySecret() {
    if (!setupData) return;
    try {
      await navigator.clipboard.writeText(setupData.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }

  // ── Reset ─────────────────────────────────────────────────────

  function reset() {
    setPhase('idle');
    setLoad('idle');
    setSetupData(null);
    setCode('');
    setDisableCode('');
    setError(null);
  }

  // ── Render phases ──────────────────────────────────────────────

  if (phase === 'disabled') {
    return (
      <div className="space-y-3">
        <div className="alert alert-success">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <span>MFA deshabilitado correctamente.</span>
        </div>
        <button type="button" onClick={reset} className="btn-outline text-sm">
          Habilitar MFA
        </button>
      </div>
    );
  }

  if (phase === 'success') {
    return (
      <div className="space-y-3">
        <div className="alert alert-success">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <span>MFA habilitado. Necesitás tu app autenticadora para iniciar sesión.</span>
        </div>
        <button type="button" onClick={reset} className="btn-outline text-sm">
          Entendido
        </button>
      </div>
    );
  }

  if (phase === 'show-secret' && setupData) {
    return (
      <div className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Escaneá el QR con tu app (Google Authenticator, Authy, 1Password) o ingresá la clave manualmente.
        </p>

        {/* Manual secret key */}
        <div
          className="rounded-xl p-4"
          style={{ background: 'color-mix(in srgb, var(--color-surface-elev) 60%, transparent)', border: '1px solid var(--border-divider)' }}
        >
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}>
            Clave secreta (ingresá manualmente si no podés escanear):
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm break-all select-all" style={{ color: 'var(--color-text)' }}>
              {setupData.secret}
            </code>
            <button type="button" onClick={copySecret} className="btn-ghost shrink-0 text-xs px-2 py-1" title="Copiar">
              {copied ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" style={{ color: 'var(--color-success)' }}>
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                  <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* otpauth URL for manual addition */}
        <details className="text-xs" style={{ color: 'var(--color-muted)' }}>
          <summary className="cursor-pointer hover:text-[var(--color-text)]" style={{ fontFamily: 'var(--font-display)' }}>
            Prefiero agregar desde URL manualmente
          </summary>
          <div className="mt-1 p-2 rounded" style={{ background: 'var(--color-surface)', border: '1px solid var(--border-divider)' }}>
            <code className="break-all text-[10px]">{setupData.otpauthUrl}</code>
          </div>
        </details>

        {/* Code input */}
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}>
              Código de verificación (6 dígitos)
            </span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="input mt-1 text-center font-mono text-lg tracking-widest"
            />
          </label>
          {error && <div className="alert alert-danger text-sm">{error}</div>}
          <button
            type="button"
            onClick={verifySetup}
            disabled={code.length < 6 || load === 'verifying'}
            className="btn-primary w-full"
          >
            {load === 'verifying' ? 'Verificando…' : 'Habilitar MFA'}
          </button>
        </div>

        <button type="button" onClick={reset} className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Cancelar
        </button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="space-y-3">
        <div className="alert alert-danger">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span>{error ?? 'Error desconocido'}</span>
        </div>
        <button type="button" onClick={reset} className="btn-outline text-sm">
          Volver
        </button>
      </div>
    );
  }

  // ── Idle state ────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {error && <div className="alert alert-danger text-sm">{error}</div>}

      {mfaEnabled ? (
        <>
          <div className="flex items-center gap-2">
            <span className="status-dot status-online" />
            <span className="text-sm font-semibold" style={{ color: 'var(--color-success)', fontFamily: 'var(--font-display)' }}>
              MFA habilitado
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Necesitás tu app autenticadora para iniciar sesión.
          </p>
          <details className="space-y-2">
            <summary
              className="text-xs cursor-pointer"
              style={{ color: 'var(--color-danger)', fontFamily: 'var(--font-display)' }}
            >
              Deshabilitar MFA
            </summary>
            <div className="space-y-2 pl-1">
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Confirmá con un código de tu app autenticadora.
              </p>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="Código MFA"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="input text-center font-mono text-sm tracking-widest"
              />
              <button
                type="button"
                onClick={disableMfa}
                disabled={disableCode.length < 6 || load === 'disabling'}
                className="btn-danger text-sm"
              >
                {load === 'disabling' ? 'Deshabilitando…' : 'Confirmar y deshabilitar'}
              </button>
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="status-dot status-offline" />
            <span className="text-sm font-semibold" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}>
              MFA deshabilitado
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Agregá una capa extra de seguridad usando tu app autenticadora.
          </p>
          <button type="button" onClick={startSetup} disabled={load === 'loading'} className="btn-primary">
            {load === 'loading' ? 'Cargando…' : 'Habilitar MFA'}
          </button>
        </>
      )}
    </div>
  );
}
