// 'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';

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

export function HistorySidebar({ currentConversationId, onSelectConversation }: HistorySidebarProps) {
  const auth = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const refresh = async (q?: string) => {
    if (!auth.user) return;
    setLoading(true);
    try {
      const url = q ? `/api/conversations?q=${encodeURIComponent(q)}` : '/api/conversations';
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
        onClick={() => setOpen(!open)}
        className="lg:hidden fixed left-4 top-4 z-10 rounded border border-neutral-700 bg-bg-subtle px-2 py-1 text-xs"
      >
        {open ? 'X' : '≡ Historial'}
      </button>

      <aside
        className={`${open ? 'block' : 'hidden'} lg:block w-full lg:w-64 lg:flex-none lg:mr-4 mb-4 lg:mb-0`}
      >
        <div className="rounded-md border border-neutral-800 bg-bg-subtle p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium uppercase text-fg-muted">Historial</h3>
            <button
              onClick={handleNew}
              className="text-xs text-fg-muted hover:text-fg"
              title="Nueva conversacion"
            >
              + Nueva
            </button>
          </div>

          <div className="mb-2 flex gap-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                // Debounced fetch
                clearTimeout((window as unknown as { _searchTimer?: ReturnType<typeof setTimeout> })._searchTimer);
                (window as unknown as { _searchTimer?: ReturnType<typeof setTimeout> })._searchTimer = setTimeout(() => {
                  void refresh(e.target.value);
                }, 300);
              }}
              placeholder="Buscar..."
              className="w-full rounded border border-neutral-700 bg-bg px-2 py-1 text-xs placeholder:text-fg-muted focus:border-accent focus:outline-none"
            />
          </div>

          {conversations.length === 0 ? (
            <p className="text-xs text-fg-muted">Sin conversaciones todavía.</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    onClick={() => handleSelect(c.id)}
                    className={`w-full text-left rounded px-2 py-1.5 text-xs hover:bg-bg ${currentConversationId === c.id ? 'bg-bg border border-accent' : ''}`}
                  >
                    <div className="font-medium truncate">
                      {c.title || 'Sin titulo'}
                    </div>
                    <div className="text-fg-muted">
                      {c.messageCount} msg · {new Date(c.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                  <button
                    onClick={(e) => handleExport(e, c.id)}
                    title="Exportar conversacion"
                    className="absolute right-1 top-1 hidden rounded p-1 text-fg-muted hover:text-fg group-hover:block"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {loading && <p className="mt-2 text-xs text-fg-muted">Cargando…</p>}
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
