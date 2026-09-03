'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Abstention } from '@ftth-copilot/shared';
import { useAuth } from '@/lib/auth/client';
import {
  ArrowDownTrayIcon,
  Bars3Icon,
  ChatBubbleLeftRightIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from './icons';

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface ConversationDetail {
  id: string;
  title: string | null;
  connectionId: string | null;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCalls?: Array<{ name: string; args: Record<string, unknown> }> | null;
    createdAt: string;
  }>;
}

export interface HistorySidebarProps {
  currentConversationId?: string | undefined;
  onSelectConversation: (id: string | undefined) => void;
}

export function HistorySidebar({
  currentConversationId,
  onSelectConversation,
}: HistorySidebarProps) {
  const auth = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const userId = auth.user?.id;

  const refresh = useCallback(async (q?: string) => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const url = q
        ? `/api/conversations?q=${encodeURIComponent(q)}`
        : '/api/conversations';
      const r = await fetch(url, { credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? 'No se pudo cargar el historial.');
      setConversations(data.conversations ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo cargar el historial.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [currentConversationId, refresh]);

  useEffect(
    () => () => {
      clearTimeout(searchTimer.current);
    },
    [],
  );

  if (!auth.user) return null;

  function handleNew() {
    onSelectConversation(undefined);
    setOpen(false);
  }

  function handleSelect(id: string) {
    onSelectConversation(id);
    setOpen(false);
  }

  function handleExport(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    window.open('/api/conversations/' + id + '/export?format=text', '_blank', 'noopener');
  }

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="btn-outline self-start lg:hidden" aria-label="Abrir historial">
          <Bars3Icon className="h-4 w-4" />
          Historial
        </button>
      )}

      <aside
        className={`${open ? 'fixed inset-0 z-40 bg-[#061018]/80 p-3 backdrop-blur-md' : 'hidden'} lg:static lg:block lg:w-64 lg:flex-none lg:bg-transparent lg:p-0`}
      >
        <div className="card flex h-full max-w-sm flex-col overflow-hidden lg:max-w-none lg:rounded-none lg:border-0 lg:border-r lg:border-white/[0.06] lg:bg-black/10 lg:shadow-none">
          <header className="flex items-center justify-between gap-2 px-4 py-4">
            <div className="flex items-center gap-2">
              <ChatBubbleLeftRightIcon className="h-4 w-4 text-cyan-300" />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-500">
                Historial
              </h3>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={handleNew} className="btn-outline px-2.5 py-1.5" title="Nueva conversación">
                <PlusIcon className="h-4 w-4" />
                <span>Nueva</span>
              </button>
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost px-2.5 lg:hidden" aria-label="Cerrar historial">
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="border-t border-white/[0.05] px-4 py-3">
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  const query = e.target.value;
                  setSearchQuery(query);
                  clearTimeout(searchTimer.current);
                  searchTimer.current = setTimeout(() => {
                    void refresh(query);
                  }, 300);
                }}
                placeholder="Buscar conversaciones…"
                className="input pl-8"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                <ChatBubbleLeftRightIcon className="h-8 w-8 text-neutral-500" />
                <p className="text-sm font-medium text-neutral-50">
                  {searchQuery ? 'Sin resultados' : 'Sin conversaciones'}
                </p>
                <p className="text-xs text-neutral-500">
                  {searchQuery
                    ? 'Probá con otro término.'
                    : 'Hacé tu primera pregunta para empezar.'}
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {conversations.map((c) => {
                  const isActive = currentConversationId === c.id;
                  return (
                    <li key={c.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => handleSelect(c.id)}
                        className={`flex w-full items-start gap-2.5 rounded-lg border py-2 pl-3 pr-10 text-left text-sm transition-colors ${
                          isActive
                            ? 'border-cyan-300/20 bg-cyan-400/[0.08] text-white'
                            : 'border-transparent text-neutral-400 hover:border-white/[0.06] hover:bg-white/[0.025] hover:text-white'
                        }`}
                      >
                        <ChatBubbleLeftRightIcon
                          className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                            isActive ? 'text-cyan-300' : 'text-neutral-500'
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {c.title || 'Sin título'}
                          </span>
                          <span className="mt-0.5 block text-xs text-neutral-500">
                            {c.messageCount} mensaje{c.messageCount === 1 ? '' : 's'} ·{' '}
                            {new Date(c.updatedAt).toLocaleDateString('es-AR')}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleExport(e, c.id)}
                        title="Exportar conversación"
                        aria-label="Exportar conversación"
                        className="absolute right-2 top-2 flex rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-950/80 hover:text-neutral-50 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
                      >
                        <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {loading && (
              <p role="status" className="mt-3 px-3 text-xs text-neutral-400">Cargando…</p>
            )}
            {error && <p role="alert" className="mt-3 px-3 text-xs text-red-300">{error}</p>}
          </div>
        </div>
      </aside>
    </>
  );
}

export async function loadConversation(
  id: string,
): Promise<{
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolsUsed?: Array<{ name: string; args: Record<string, unknown> }>;
    abstention?: Abstention;
    timestamp: number;
  }>;
  connectionId: string | null;
} | null> {
  const r = await fetch('/api/conversations/' + id, { credentials: 'include' });
  if (!r.ok) return null;
  const data = (await r.json()) as { conversation: ConversationDetail };
  if (!data.conversation) return null;
  return {
    connectionId: data.conversation.connectionId,
    messages: data.conversation.messages.map((m) => {
      // Reconstruct the abstention envelope from the synthetic
      // `__abstention__` row that the route persisted into
      // `Message.toolCalls`. Older messages (pre-Fase-C) won't have the
      // row, so we leave `abstention` undefined.
      const toolCalls = m.toolCalls ?? undefined;
      const abstentionRow = toolCalls?.find(
        (t) => t && (t as { name?: string }).name === '__abstention__',
      );
      const rawResult = abstentionRow
        ? (abstentionRow as unknown as { result?: unknown }).result
        : undefined;
      // Light-shape validation: the route only writes envelopes that pass
      // `abstentionSchema`, but a defensive cast here keeps a corrupted row
      // from crashing the bubble render.
      const abstention = isAbstention(rawResult) ? rawResult : undefined;
      return {
        id: m.id,
        role: (m.role === 'tool' ? 'assistant' : m.role) as 'user' | 'assistant',
        content: m.content,
        toolsUsed: toolCalls ?? undefined,
        abstention,
        timestamp: new Date(m.createdAt).getTime(),
      };
    }),
  };
}

/**
 * Lightweight runtime guard for the `ftth.abstention.v1` envelope shape
 * reconstructed from `Message.toolCalls[].result`. Mirrors the contract
 * defined in `packages/shared/src/contracts.ts`; we don't pull the zod
 * schema into the browser bundle just to validate history rows.
 */
function isAbstention(value: unknown): value is Abstention {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v['schema'] === 'ftth.abstention.v1' &&
    typeof v['reason'] === 'string' &&
    typeof v['severity'] === 'string' &&
    Array.isArray(v['missing']) &&
    Array.isArray(v['available']) &&
    typeof v['nextStep'] === 'string' &&
    Array.isArray(v['toolsAffected'])
  );
}
