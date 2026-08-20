'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { hasPermission, type Permission } from '@/lib/auth/permissions';

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

export function ConnectorManager() {
  const auth = useAuth();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<'SMARTOLT' | 'MIKROWISP' | 'NETSENSE'>('SMARTOLT');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canManage = auth.user && hasPermission(auth.user.role, 'manage_connectors' as Permission);

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
    if (!confirm('¿Borrar este connector? El chat volverá a usar el mock.')) return;
    await fetch(`/api/connectors/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await refresh();
  }

  return (
    <section className="mb-6 rounded-md border border-neutral-800 bg-bg-subtle p-4">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">NMS Connectors</h2>
        {canManage && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-xs text-fg-muted hover:text-fg"
          >
            {showForm ? 'Cancelar' : '+ Agregar connector'}
          </button>
        )}
      </header>

      {connectors.length === 0 ? (
        <p className="text-xs text-fg-muted">
          No hay connectors. El chat usa datos mock. Agregá uno para conectar tu NMS real.
        </p>
      ) : (
        <ul className="space-y-2">
          {connectors.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded border border-neutral-800 bg-bg px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">{c.label}</span>{' '}
                <span className="text-xs text-fg-muted">({c.provider})</span>
                <div className="text-xs text-fg-muted">
                  Estado: {c.status}
                  {c.baseUrl ? ` · ${c.baseUrl}` : ''}
                </div>
              </div>
              {canManage && (
                <button
                  onClick={() => void remove(c.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Borrar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {loading && <p className="mt-2 text-xs text-fg-muted">Cargando…</p>}

      {showForm && canManage && (
        <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
            className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          >
            <option value="SMARTOLT">SmartOLT</option>
            <option value="MIKROWISP">Mikrowisp</option>
            <option value="NETSENSE">NetSense</option>
          </select>
          <input
            type="text"
            placeholder="Etiqueta (ej. 'SmartOLT prod')"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
          <input
            type="password"
            placeholder="API key (se guarda encriptada)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
            className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
          <input
            type="url"
            placeholder="Base URL (opcional, ej. https://demo.smartolt.com)"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
          {error && <div className="text-xs text-red-400">{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? 'Guardando…' : 'Guardar connector'}
          </button>
          <p className="text-xs text-fg-muted">
            La arquitectura está lista. Cuando llegue el adapter HTTP real a SmartOLT/Mikrowisp, el chat usará tu connector automáticamente.
          </p>
        </form>
      )}
    </section>
  );
}
