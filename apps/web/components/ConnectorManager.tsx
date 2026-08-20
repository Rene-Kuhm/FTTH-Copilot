'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
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

interface Connector {
  id: string;
  provider: 'SMARTOLT' | 'MIKROWISP' | 'NETSENSE';
  label: string;
  baseUrl: string | null;
  status: 'connected' | 'error' | 'pending';
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

const STATUS_META: Record<
  Connector['status'],
  {
    label: string;
    className: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  connected: {
    label: 'Connected',
    className:
      'bg-success/15 text-emerald-500 ring-1 ring-inset ring-success/30',
    Icon: CheckCircleIcon,
  },
  error: {
    label: 'Error',
    className: 'bg-danger/15 text-red-500 ring-1 ring-inset ring-danger/30',
    Icon: XCircleIcon,
  },
  pending: {
    label: 'Pending',
    className:
      'bg-warning/15 text-amber-500 ring-1 ring-inset ring-warning/30',
    Icon: ServerStackIcon,
  },
};

export function ConnectorManager() {
  const auth = useAuth();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<'SMARTOLT' | 'MIKROWISP' | 'NETSENSE'>(
    'SMARTOLT',
  );
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canManage =
    auth.user && hasPermission(auth.user.role, 'manage_connectors' as Permission);

  const refresh = async () => {
    if (!auth.user) return;
    setLoading(true);
    try {
      const r = await fetch('/api/connectors', { credentials: 'include' });
      const data = await r.json();
      setConnectors(data.connectors ?? []);
    } catch {
      // noop
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [auth.user]);

  if (!auth.user) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch('/api/connectors/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider,
          label,
          apiKey,
          baseUrl: baseUrl || null,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? 'Error');
      }
      setShowForm(false);
      setLabel('');
      setApiKey('');
      setBaseUrl('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Borrar este connector? El chat volverá a usar el mock.'))
      return;
    await fetch(`/api/connectors/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await refresh();
  }

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 ring-1 ring-inset ring-blue-500/30">
            <ServerStackIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-50">NMS Connectors</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {connectors.length === 0
                ? 'Sin connectors configurados'
                : `${connectors.length} connector${connectors.length === 1 ? '' : 's'} configurado${connectors.length === 1 ? '' : 's'}`}
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
              <>
                <XMarkIcon className="h-4 w-4" />
                Cancelar
              </>
            ) : (
              <>
                <PlusIcon className="h-4 w-4" />
                Agregar connector
              </>
            )}
          </button>
        )}
      </header>

      <div className="border-t border-neutral-800 px-5 py-4">
        {connectors.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-8 text-center">
            <ServerStackIcon className="h-8 w-8 text-neutral-500" />
            <p className="text-sm font-medium text-neutral-50">No hay connectors</p>
            <p className="max-w-md text-xs text-neutral-500">
              El chat usa datos mock. Agregá un connector para conectar tu NMS real
              (SmartOLT, Mikrowisp, NetSense).
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {connectors.map((c) => {
              const status = STATUS_META[c.status];
              const StatusIcon = status.Icon;
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-neutral-800 bg-neutral-950/60 px-4 py-3 transition-colors hover:border-neutral-700 hover:bg-neutral-950"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-neutral-400 ring-1 ring-inset ring-neutral-800">
                      <ServerStackIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-neutral-50">
                          {c.label}
                        </span>
                        <span className="badge bg-neutral-800 text-neutral-400 ring-1 ring-inset ring-neutral-800">
                          {c.provider}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
                        <span className={status.className + ' badge'}>
                          <StatusIcon className="h-3.5 w-3.5" />
                          {status.label}
                        </span>
                        {c.baseUrl && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{c.baseUrl}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => void remove(c.id)}
                      className="btn-danger px-2.5 py-1.5"
                      aria-label={`Borrar ${c.label}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {loading && (
          <p className="mt-3 text-xs text-neutral-500">Cargando…</p>
        )}
      </div>

      {showForm && canManage && (
        <form
          onSubmit={(e) => void submit(e)}
          className="space-y-4 border-t border-neutral-800 bg-neutral-950/40 px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 sm:col-span-1">
              <span className="text-xs font-medium text-neutral-400">Provider</span>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as typeof provider)}
                className="input"
              >
                <option value="SMARTOLT">SmartOLT</option>
                <option value="MIKROWISP">Mikrowisp</option>
                <option value="NETSENSE">NetSense</option>
              </select>
            </label>
            <label className="block space-y-1.5 sm:col-span-1">
              <span className="text-xs font-medium text-neutral-400">Etiqueta</span>
              <input
                type="text"
                placeholder="Ej. 'SmartOLT prod'"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                className="input"
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-neutral-400">API key</span>
              <input
                type="password"
                placeholder="Se guarda encriptada"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
                className="input"
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-neutral-400">
                Base URL <span className="text-neutral-500">(opcional)</span>
              </span>
              <input
                type="url"
                placeholder="https://demo.smartolt.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="input"
              />
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-neutral-500">
              La arquitectura está lista. Cuando llegue el adapter HTTP real, el chat
              usará tu connector automáticamente.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary sm:w-auto"
            >
              <KeyIcon className="h-4 w-4" />
              {submitting ? 'Guardando…' : 'Guardar connector'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
