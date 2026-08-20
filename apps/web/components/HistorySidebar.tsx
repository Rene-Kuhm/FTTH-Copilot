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

  const refresh = async () => {
    if (!auth.user) return;
    setLoading(true);
    try {
      const r = await fetch('/api/conversations', { credentials: 'include' });
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

          {conversations.length === 0 ? (
            <p className="text-xs text-fg-muted">Sin conversaciones todavía.</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id}>
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
