'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth/client';
import { hasPermission, type Permission } from '@/lib/auth/permissions';
import { HistorySidebar, loadConversation } from './HistorySidebar';
import {
  ChartBarSquareIcon,
  ChatBubbleLeftRightIcon,
  CommandLineIcon,
  CpuChipIcon,
  PaperAirplaneIcon,
  ServerStackIcon,
  SignalIcon,
  SparklesIcon,
} from './icons';

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

interface SuggestedQuestion {
  text: string;
  Icon: React.ComponentType<{ className?: string }>;
  tint: string;
}

const SUGGESTED_QUESTIONS: SuggestedQuestion[] = [
  {
    text: '¿Cuántas ONUs están offline ahora?',
    Icon: SignalIcon,
    tint: 'text-red-500 bg-red-500/10 ring-danger/30',
  },
  {
    text: '¿Qué OLTs tienen temperatura alta?',
    Icon: CpuChipIcon,
    tint: 'text-amber-500 bg-warning/10 ring-warning/30',
  },
  {
    text: 'Dame el detalle de la ONU con serial SN-001',
    Icon: ServerStackIcon,
    tint: 'text-blue-500 bg-blue-500/10 ring-blue-500/30',
  },
  {
    text: '¿Cuál es el uptime promedio de la red?',
    Icon: ChartBarSquareIcon,
    tint: 'text-emerald-500 bg-success/10 ring-success/30',
  },
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
  function nextSeq() {
    return ++seqRef.current;
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const canChat =
    auth.user && hasPermission(auth.user.role, 'chat' as Permission);

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
    <section className="card overflow-hidden">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 ring-1 ring-inset ring-blue-500/30">
          <ChatBubbleLeftRightIcon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-neutral-50">Copilot Chat</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Preguntale a tu red FTTH en lenguaje natural
          </p>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row">
        <HistorySidebar
          currentConversationId={conversationId}
          onSelectConversation={handleSelectConversation}
        />
        <div className="flex flex-1 flex-col gap-4 px-5 py-5">
          <div
            ref={scrollRef}
            className="flex min-h-[320px] max-h-[60vh] flex-col gap-3 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 p-4"
          >
            {messages.length === 0 ? (
              <EmptyState
                disabled={isLoading || !canChat}
                onPick={(q) => void sendMessage(q)}
              />
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
            {isLoading && (
              <div className="flex items-center gap-2 px-1 text-sm text-neutral-400">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500 [animation-delay:150ms]" />
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500 [animation-delay:300ms]" />
                <span className="ml-1 text-xs text-neutral-500">
                  Analizando tu red…
                </span>
              </div>
            )}
          </div>

          {!canChat && auth.user && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm text-amber-500">
              <CommandLineIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                Read-only mode — you do not have permission to send messages.
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-danger/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-500">
              {error}
            </div>
          )}

          {canChat && (
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Preguntale algo a tu red…"
                disabled={isLoading}
                className="input"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="btn-primary px-4"
                aria-label="Enviar mensaje"
              >
                <PaperAirplaneIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Enviar</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function EmptyState({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (q: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-500 ring-1 ring-inset ring-blue-500/30">
        <SparklesIcon className="h-7 w-7" />
      </span>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-neutral-50">
          Hacé tu primera pregunta
        </h3>
        <p className="mx-auto max-w-md text-sm text-neutral-500">
          Tu copilot analiza tu red FTTH y responde con datos en vivo. Probá con
          una de estas:
        </p>
      </div>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q.text}
            type="button"
            onClick={() => onPick(q.text)}
            disabled={disabled}
            className="group flex items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-neutral-700 hover:bg-neutral-800 disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <span
              className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${q.tint}`}
            >
              <q.Icon className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm font-medium text-neutral-50">
              {q.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div
      className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}
    >
      {message.toolsUsed && message.toolsUsed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <CommandLineIcon className="h-3.5 w-3.5" />
          <span className="font-medium">Tools:</span>
          {message.toolsUsed.map((t, i) => (
            <span
              key={i}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-0.5 font-mono text-[11px] text-neutral-400"
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-md bg-blue-500 text-white shadow-sm shadow-accent/20'
            : 'rounded-bl-md border border-neutral-800 bg-neutral-900 text-neutral-50'
        }`}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}
