'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { useConnectors, type ClientConnector } from '@/lib/connectors/client';
import { hasPermission, type Permission } from '@/lib/auth/permissions';
import {
  CheckCircleIcon,
  KeyIcon,
  PlusIcon,
  ServerStackIcon,
  TrashIcon,
  XCircleIcon,
  XMarkIcon,
} from './icons';

const STATUS_STYLE: Record<
  ClientConnector['status'],
  {
    label: string;
    style: React.CSSProperties;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  connected: {
    label: 'Conectado',
    style: {
      background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
      color: 'var(--color-success)',
      border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
      borderRadius: 'var(--radius-pill)',
      padding: '0.2rem 0.55rem',
      fontSize: '0.6875rem',
      fontWeight: 650,
      fontFamily: 'var(--font-display)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.3rem',
    },
    Icon: CheckCircleIcon,
  },
  error: {
    label: 'Error',
    style: {
      background: 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
      color: 'var(--color-danger)',
      border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)',
      borderRadius: 'var(--radius-pill)',
      padding: '0.2rem 0.55rem',
      fontSize: '0.6875rem',
      fontWeight: 650,
      fontFamily: 'var(--font-display)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.3rem',
    },
    Icon: XCircleIcon,
  },
  pending: {
    label: 'Pendiente',
    style: {
      background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
      color: 'var(--color-warning)',
      border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
      borderRadius: 'var(--radius-pill)',
      padding: '0.2rem 0.55rem',
      fontSize: '0.6875rem',
      fontWeight: 650,
      fontFamily: 'var(--font-display)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.3rem',
    },
    Icon: ServerStackIcon,
  },
};

async function requestTest(id: string): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`/api/connectors/${id}/test`, {
    method: 'POST',
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok && data.ok === true,
    error: data.error ?? (!response.ok ? 'No se pudo probar la conexión.' : undefined),
  };
}

export function ConnectorManager() {
  const auth = useAuth();
  const connectorState = useConnectors();
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<'SMARTOLT' | 'MIKROWISP' | 'MIKROTIK'>('SMARTOLT');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const canManage =
    auth.user && hasPermission(auth.user.role, 'manage_connectors' as Permission);

  if (!auth.user) return null;

  async function testConnector(id: string, labelToTest: string) {
    setTestingId(id);
    setFeedback(null);
    try {
      const result = await requestTest(id);
      await connectorState.refresh();
      setFeedback(
        result.ok
          ? { kind: 'success', text: `${labelToTest} quedó conectado y listo para usar.` }
          : {
              kind: 'error',
              text: `No se pudo conectar ${labelToTest}: ${result.error ?? 'revisá las credenciales y la URL.'}`,
            },
      );
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'No se pudo probar la conexión.',
      });
    } finally {
      setTestingId(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFeedback(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/connectors/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider, label, apiKey, baseUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.connector?.id) {
        throw new Error(data.error ?? 'No se pudo guardar el conector.');
      }

      const testResult = await requestTest(data.connector.id);
      await connectorState.refresh();
      setShowForm(false);
      setLabel('');
      setApiKey('');
      setBaseUrl('');
      setFeedback(
        testResult.ok
          ? {
              kind: 'success',
              text: `${data.connector.label} quedó conectado y listo para usar.`,
            }
          : {
              kind: 'error',
              text: `El conector se guardó, pero la prueba falló: ${testResult.error ?? 'revisá las credenciales y volvé a probar.'}`,
            },
      );
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'No se pudo guardar el conector.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar este conector? El chat dejará de usarlo inmediatamente.')) {
      return;
    }
    setFeedback(null);
    const response = await fetch(`/api/connectors/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setFeedback({
        kind: 'error',
        text: data.error ?? 'No se pudo eliminar el conector.',
      });
      return;
    }
    await connectorState.refresh();
    setFeedback({ kind: 'success', text: 'Conector eliminado.' });
  }

  return (
    <section className="card overflow-hidden" style={{ color: 'var(--color-text)' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5"
        style={{ borderBottom: '1px solid var(--border-divider)' }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: 'rgb(242 48 119 / 0.1)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
              color: 'var(--color-accent)',
            }}
          >
            <ServerStackIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2
              className="text-sm font-semibold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
            >
              Conectores NMS
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>
              {connectorState.connectors.length === 0
                ? 'Todavía no configuraste una red'
                : `${connectorState.connectors.length} conector${connectorState.connectors.length === 1 ? '' : 'es'} configurado${connectorState.connectors.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="btn-outline"
          >
            {showForm ? <XMarkIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
            {showForm ? 'Cancelar' : 'Agregar conector'}
          </button>
        )}
      </header>

      {/* Content */}
      <div className="px-5 py-4 sm:px-6" style={{ borderTop: '1px solid var(--border-divider)' }}>
        {feedback && (
          <div
            role={feedback.kind === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className="mb-4 rounded-lg px-3 py-2 text-sm"
            style={
              feedback.kind === 'error'
                ? {
                    border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)',
                    background: 'color-mix(in srgb, var(--color-danger) 10%, transparent)',
                    color: 'var(--color-danger)',
                  }
                : {
                    border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
                    background: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
                    color: 'var(--color-success)',
                  }
            }
          >
            {feedback.text}
          </div>
        )}

        {connectorState.loading ? (
          <p role="status" className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Cargando conectores…
          </p>
        ) : connectorState.connectors.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-xl px-4 py-9 text-center"
            style={{
              border: '1px dashed var(--border-divider)',
              background: 'color-mix(in srgb, var(--color-bg) 70%, transparent)',
            }}
          >
            <ServerStackIcon className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />
            <p
              className="text-sm font-semibold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
            >
              No hay conectores
            </p>
            <p
              className="max-w-md text-xs leading-5"
              style={{ color: 'var(--color-muted)' }}
            >
              Agregá SmartOLT, Mikrowisp o MikroTik y validá la conexión para consultar tu red
              real.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {connectorState.connectors.map((connector) => {
              const status = STATUS_STYLE[connector.status];
              const StatusIcon = status.Icon;
              const testing = testingId === connector.id;
              return (
                <li
                  key={connector.id}
                  className="rounded-xl transition-colors"
                  style={{
                    border: '1px solid var(--border-divider)',
                    background: 'color-mix(in srgb, var(--color-bg) 70%, transparent)',
                    padding: '0.875rem 1rem',
                  }}
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    {/* Info */}
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                        style={{
                          background: 'color-mix(in srgb, var(--color-muted) 8%, transparent)',
                          border: '1px solid var(--border-divider)',
                          color: 'var(--color-muted)',
                        }}
                      >
                        <ServerStackIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="truncate text-sm font-semibold"
                            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
                          >
                            {connector.label}
                          </span>
                          <span
                            className="badge"
                            style={{
                              background: 'color-mix(in srgb, var(--color-muted) 10%, transparent)',
                              color: 'var(--color-muted)',
                              border: '1px solid var(--border-divider)',
                              fontFamily: 'var(--font-display)',
                            }}
                          >
                            {connector.provider}
                          </span>
                          <span style={status.style}>
                            <StatusIcon className="h-3.5 w-3.5" />
                            {status.label}
                          </span>
                        </div>
                        {connector.baseUrl && (
                          <p className="mt-1 truncate text-xs" style={{ color: 'var(--color-muted)' }}>
                            {connector.baseUrl}
                          </p>
                        )}
                        {connector.lastError && (
                          <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                            {connector.lastError}
                          </p>
                        )}
                        {connector.lastCheckedAt && (
                          <p className="mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                            Última prueba:{' '}
                            {new Intl.DateTimeFormat('es-AR', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            }).format(new Date(connector.lastCheckedAt))}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    {canManage && (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => void testConnector(connector.id, connector.label)}
                          disabled={testingId !== null}
                          className="btn-outline"
                        >
                          <CheckCircleIcon className="h-4 w-4" />
                          {testing
                            ? 'Probando…'
                            : connector.status === 'connected'
                              ? 'Probar'
                              : 'Reintentar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(connector.id)}
                          disabled={testingId !== null}
                          className="btn-danger"
                          aria-label={`Eliminar ${connector.label}`}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Form */}
      {showForm && canManage && (
        <form
          onSubmit={(event) => void submit(event)}
          className="space-y-4 px-5 py-5 sm:px-6"
          style={{ borderTop: '1px solid var(--border-divider)', background: 'color-mix(in srgb, var(--color-bg) 60%, transparent)' }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span
                className="text-xs font-medium"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-muted)' }}
              >
                Proveedor
              </span>
              <select
                value={provider}
                onChange={(event) => {
                  const next = event.target.value as typeof provider;
                  setProvider(next);
                  setBaseUrl('');
                }}
                className="input"
                style={{ color: 'var(--color-text)' }}
              >
                <option value="SMARTOLT">SmartOLT</option>
                <option value="MIKROWISP">Mikrowisp</option>
                <option value="MIKROTIK">MikroTik RouterOS v7</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span
                className="text-xs font-medium"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-muted)' }}
              >
                Etiqueta
              </span>
              <input
                type="text"
                name="connector-label"
                autoComplete="organization"
                placeholder="Ej. SmartOLT producción"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                required
                className="input"
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span
                className="text-xs font-medium"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-muted)' }}
              >
                {provider === 'MIKROTIK'
                  ? 'Credenciales (usuario:contraseña)'
                  : 'Clave de API'}
              </span>
              <input
                type="password"
                name="connector-api-key"
                autoComplete="off"
                placeholder={
                  provider === 'MIKROTIK'
                    ? 'admin:clave (se guarda cifrada)'
                    : 'Se guarda cifrada'
                }
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                required
                className="input"
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span
                className="text-xs font-medium"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-muted)' }}
              >
                URL base
              </span>
              <input
                type="url"
                name="connector-base-url"
                autoComplete="url"
                placeholder={
                  provider === 'SMARTOLT'
                    ? 'https://tu-cuenta.smartolt.com'
                    : provider === 'MIKROWISP'
                      ? 'https://tu-mikrowisp.example.com/api/v1'
                      : 'https://router.tu-dominio.com'
                }
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                required
                className="input"
              />
            </label>
          </div>

          {formError && (
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
              {formError}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Solo se permiten destinos HTTPS públicos. La clave se almacena cifrada.
            </p>
            <button type="submit" disabled={submitting} className="btn-primary sm:w-auto">
              <KeyIcon className="h-4 w-4" />
              {submitting ? 'Guardando y probando…' : 'Guardar y probar'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
