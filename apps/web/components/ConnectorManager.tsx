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

const STATUS_META: Record<
  ClientConnector['status'],
  { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  connected: {
    label: 'Conectado',
    className: 'bg-success/15 text-emerald-400 ring-1 ring-inset ring-success/30',
    Icon: CheckCircleIcon,
  },
  error: {
    label: 'Error',
    className: 'bg-danger/15 text-red-400 ring-1 ring-inset ring-danger/30',
    Icon: XCircleIcon,
  },
  pending: {
    label: 'Pendiente',
    className: 'bg-warning/15 text-amber-400 ring-1 ring-inset ring-warning/30',
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
  const [provider, setProvider] = useState<'SMARTOLT' | 'MIKROWISP'>('SMARTOLT');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.smartolt.com');
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
      setBaseUrl(provider === 'SMARTOLT' ? 'https://api.smartolt.com' : '');
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
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-inset ring-cyan-300/15">
            <ServerStackIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">Conectores NMS</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
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
            {showForm ? (
              <XMarkIcon className="h-4 w-4" />
            ) : (
              <PlusIcon className="h-4 w-4" />
            )}
            {showForm ? 'Cancelar' : 'Agregar conector'}
          </button>
        )}
      </header>

      <div className="border-t border-white/[0.06] px-5 py-4 sm:px-6">
        {feedback && (
          <div
            role={feedback.kind === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
              feedback.kind === 'error'
                ? 'border-danger/30 bg-red-500/10 text-red-300'
                : 'border-success/30 bg-success/10 text-emerald-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {connectorState.loading ? (
          <p role="status" className="text-sm text-neutral-400">
            Cargando conectores…
          </p>
        ) : connectorState.connectors.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.09] bg-black/10 px-4 py-9 text-center">
            <ServerStackIcon className="h-8 w-8 text-neutral-500" />
            <p className="text-sm font-semibold text-white">No hay conectores</p>
            <p className="max-w-md text-xs leading-5 text-neutral-500">
              Agregá SmartOLT o Mikrowisp y validá la conexión para consultar tu red real.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {connectorState.connectors.map((connector) => {
              const status = STATUS_META[connector.status];
              const StatusIcon = status.Icon;
              const testing = testingId === connector.id;
              return (
                <li
                  key={connector.id}
                  className="rounded-xl border border-white/[0.07] bg-black/10 px-4 py-3.5 transition-colors hover:border-white/[0.12]"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-neutral-300 ring-1 ring-inset ring-white/[0.07]">
                        <ServerStackIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">
                            {connector.label}
                          </span>
                          <span className="badge bg-white/[0.05] text-neutral-300 ring-1 ring-inset ring-white/[0.08]">
                            {connector.provider}
                          </span>
                          <span className={`${status.className} badge`}>
                            <StatusIcon className="h-3.5 w-3.5" />
                            {status.label}
                          </span>
                        </div>
                        {connector.baseUrl && (
                          <p className="mt-1 truncate text-xs text-neutral-400">
                            {connector.baseUrl}
                          </p>
                        )}
                        {connector.lastError && (
                          <p className="mt-1 text-xs text-red-300">{connector.lastError}</p>
                        )}
                        {connector.lastCheckedAt && (
                          <p className="mt-1 text-xs text-neutral-400">
                            Última prueba:{' '}
                            {new Intl.DateTimeFormat('es-AR', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            }).format(new Date(connector.lastCheckedAt))}
                          </p>
                        )}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex flex-shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void testConnector(connector.id, connector.label)
                          }
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

      {showForm && canManage && (
        <form
          onSubmit={(event) => void submit(event)}
          className="space-y-4 border-t border-white/[0.06] bg-black/10 px-5 py-5 sm:px-6"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-neutral-300">Proveedor</span>
              <select
                value={provider}
                onChange={(event) => {
                  const next = event.target.value as typeof provider;
                  setProvider(next);
                  setBaseUrl(next === 'SMARTOLT' ? 'https://api.smartolt.com' : '');
                }}
                className="input"
              >
                <option value="SMARTOLT">SmartOLT</option>
                <option value="MIKROWISP">Mikrowisp</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-neutral-300">Etiqueta</span>
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
              <span className="text-xs font-medium text-neutral-300">Clave de API</span>
              <input
                type="password"
                name="connector-api-key"
                autoComplete="off"
                placeholder="Se guarda cifrada"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                required
                className="input"
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-neutral-300">URL base</span>
              <input
                type="url"
                name="connector-base-url"
                autoComplete="url"
                placeholder="https://api.smartolt.com"
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
              className="rounded-lg border border-danger/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {formError}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-neutral-400">
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
