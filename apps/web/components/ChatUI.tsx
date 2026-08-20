'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth/client';
import { hasPermission, type Permission } from '@/lib/auth/permissions';
import { HistorySidebar, loadConversation } from './HistorySidebar';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: ToolCall[];
  /** Monotonic sequence number used for ordering in the UI. */
  seq: number;
}

const SUGGESTED_QUESTIONS = [
  '¿Cuántas ONUs están offline ahora?',
  '¿Qué OLTs tienen temperatura alta?',
  'Dame el detalle de la ONU con serial SN-001',
  '¿Cuál es el uptime promedio de la red?',
];

export default function ChatUI() {
  const auth = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  function nextSeq() { return ++seqRef.current; }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const canChat = auth.user && hasPermission(auth.user.role, 'chat' as Permission);

  async function sendMessage(text: string) {
    if (!canChat) return;
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    setError(null);
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      seq: nextSeq(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, conversationId }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        reply: string;
        toolsUsed: ToolCall[];
        conversationId: string;
      };
      if (data.conversationId) setConversationId(data.conversationId);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.reply,
        toolsUsed: data.toolsUsed,
        seq: nextSeq(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  function handleSelectConversation(id: string | undefined) {
    setConversationId(id);
    if (!id) {
      setMessages([]);
    } else {
      void loadConversation(id).then((result) => {
        if (result) {
          const withSeq = result.messages.map((m, i) => ({ ...m, seq: i }));
          setMessages(withSeq);
        }
      });
    }
  }

  return (
    <div className="flex flex-col lg:flex-row">
      <HistorySidebar
        currentConversationId={conversationId}
        onSelectConversation={handleSelectConversation}
      />
      <div className="flex flex-1 flex-col gap-4">
      <div
        ref={scrollRef}
        className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto rounded-lg border border-neutral-800 bg-bg-subtle p-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-8 text-fg-muted">
            <p className="text-sm">
              Hacé una pregunta sobre tu red FTTH. Ejemplos:
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void sendMessage(q)}
                  disabled={isLoading || !canChat}
                  className="rounded-md border border-neutral-700 px-3 py-1.5 text-left text-xs hover:border-accent hover:bg-neutral-900 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent [animation-delay:150ms]" />
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent [animation-delay:300ms]" />
          </div>
        )}
      </div>

      {!canChat && auth.user && (
        <div className="rounded-md border border-yellow-800 bg-yellow-950/30 px-3 py-2 text-sm text-yellow-400">
          Read-only mode — you do not have permission to send messages.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {canChat && (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Preguntale algo a tu red..."
            disabled={isLoading}
            className="flex-1 rounded-md border border-neutral-700 bg-bg-subtle px-3 py-2 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
      )}
    </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      {message.toolsUsed && message.toolsUsed.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs text-fg-muted">
          {message.toolsUsed.map((t, i) => (
            <span
              key={i}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono"
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-accent text-white'
            : 'border border-neutral-800 bg-neutral-900'
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
