'use client';

import { useEffect, useState } from 'react';
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
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const refresh = async (q?: string) => {
    if (!auth.user) return;
    setLoading(true);
    try {
      const url = q
        ? `/api/conversations?q=${encodeURIComponent(q)}`
        : '/api/conversations';
      const r = await fetch(url, { credentials: 'include' });
      const data = await r.json();
      setConversations(data.conversations ?? []);
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

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [currentConversationId]);

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
    window.open('/api/conversations/' + id + '/export?format=text', '_blank');
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="btn-outline fixed left-4 top-4 z-30 lg:hidden"
        aria-label={open ? 'Close history' : 'Open history'}
      >
        {open ? (
          <XMarkIcon className="h-4 w-4" />
        ) : (
          <Bars3Icon className="h-4 w-4" />
        )}
        Historial
      </button>

      <aside
        className={`${open ? 'fixed inset-0 z-20 bg-neutral-950/70 backdrop-blur-sm' : 'hidden'} lg:static lg:block lg:w-72 lg:flex-none lg:bg-transparent`}
      >
        <div className="card flex h-full flex-col overflow-hidden lg:sticky lg:top-24">
          <header className="flex items-center justify-between gap-2 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <ChatBubbleLeftRightIcon className="h-4 w-4 text-neutral-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Historial
              </h3>
            </div>
            <button
              type="button"
              onClick={handleNew}
              className="btn-outline px-2.5 py-1.5"
              title="Nueva conversación"
            >
              <PlusIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Nueva</span>
            </button>
          </header>

          <div className="border-t border-neutral-800 px-4 py-3">
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  clearTimeout(
                    (
                      window as unknown as {
                        _searchTimer?: ReturnType<typeof setTimeout>;
                      }
                    )._searchTimer,
                  );
                  (
                    window as unknown as {
                      _searchTimer?: ReturnType<typeof setTimeout>;
                    }
                  )._searchTimer = setTimeout(() => {
                    void refresh(e.target.value);
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
                        className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          isActive
                            ? 'border-blue-500/60 bg-blue-500/10 text-neutral-50'
                            : 'border-transparent text-neutral-400 hover:border-neutral-800 hover:bg-neutral-950/60 hover:text-neutral-50'
                        }`}
                      >
                        <ChatBubbleLeftRightIcon
                          className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                            isActive ? 'text-blue-500' : 'text-neutral-500'
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {c.title || 'Sin título'}
                          </span>
                          <span className="mt-0.5 block text-xs text-neutral-500">
                            {c.messageCount} msg ·{' '}
                            {new Date(c.updatedAt).toLocaleDateString()}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleExport(e, c.id)}
                        title="Exportar conversación"
                        aria-label="Exportar conversación"
                        className="absolute right-2 top-2 hidden rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-950/80 hover:text-neutral-50 group-hover:flex"
                      >
                        <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {loading && (
              <p className="mt-3 px-3 text-xs text-neutral-500">Cargando…</p>
            )}
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
    timestamp: number;
  }>;
} | null> {
  const r = await fetch('/api/conversations/' + id, { credentials: 'include' });
  if (!r.ok) return null;
  const data = (await r.json()) as { conversation: ConversationDetail };
  if (!data.conversation) return null;
  return {
    messages: data.conversation.messages.map((m) => ({
      id: m.id,
      role: (m.role === 'tool' ? 'assistant' : m.role) as 'user' | 'assistant',
      content: m.content,
      toolsUsed: m.toolCalls ?? undefined,
      timestamp: new Date(m.createdAt).getTime(),
    })),
  };
}
