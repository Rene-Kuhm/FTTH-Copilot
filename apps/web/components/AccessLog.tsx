'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { ShieldCheckIcon } from './icons';

interface AccessEvent {
  id: string;
  sourceIp: string | null;
  category: 'access' | 'auth_failure';
  message: string;
  occurredAt: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AccessLog() {
  const auth = useAuth();
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!auth.user) return;
    setLoading(true);
    try {
      const response = await fetch('/api/security/access', { credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      setEvents(body.events ?? []);
    } catch {
      // noop
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (!auth.user) return null;
  if (!loading && events.length === 0) return null;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300 ring-1 ring-inset ring-sky-300/15">
            <ShieldCheckIcon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">Bitácora de acceso</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Accesos y fallos de autenticación en equipos</p>
          </div>
        </div>
        <span className="badge border border-white/[0.08] bg-white/[0.035] text-neutral-400">
          {events.length} evento{events.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <p className="px-6 py-4 text-xs text-neutral-500">Cargando bitácora…</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {events.map((event) => {
            const failed = event.category === 'auth_failure';
            return (
              <li key={event.id} className="flex items-start gap-3 px-5 py-3 sm:px-6">
                <span
                  className={`badge shrink-0 border ${
                    failed
                      ? 'border-rose-400/20 bg-rose-400/10 text-rose-300'
                      : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                  }`}
                >
                  {failed ? 'Fallido' : 'Acceso'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm text-white">{event.message}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-x-3 text-[11px] text-neutral-500">
                    <span className="font-mono">{event.sourceIp ?? 's/n'}</span>
                    <span>{formatTime(event.occurredAt)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
