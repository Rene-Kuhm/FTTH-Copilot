'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import type { Abstention } from '@ftth-copilot/shared';
import { useAuth } from '@/lib/auth/client';
import { useConnectors } from '@/lib/connectors/client';
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

interface DataSource {
  mode: 'live' | 'demo';
  provider: string;
  label: string;
}

/**
 * Synthetic tool row emitted by `/api/chat` whenever the agent abstains
 * in strict mode (Fase C). The ChatUI keys the warning bubble off this
 * pseudo-name and suppresses the regular tool chip for it.
 */
const ABSTENTION_PSEUDO_TOOL = '__abstention__';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: ToolCall[];
  /**
   * Optional `ftth.abstention.v1` envelope forwarded by `/api/chat`
   * when the agent abstained. Drives the warning bubble; independent
   * of `toolsUsed` so server reloads (where the synthetic row is
   * reconstructed from Message.toolCalls) and live responses (where
   * the envelope is on the response body) both render correctly.
   */
  abstention?: Abstention;
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
    tint: 'var(--color-danger)',
  },
  {
    text: '¿Qué OLTs tienen temperatura alta?',
    Icon: CpuChipIcon,
    tint: 'var(--color-warning)',
  },
  {
    text: 'Dame el detalle de la ONU con serial SN-001',
    Icon: ServerStackIcon,
    tint: 'var(--color-accent)',
  },
  {
    text: '¿Cuál es el uptime promedio de la red?',
    Icon: ChartBarSquareIcon,
    tint: 'var(--color-success)',
  },
];

export interface ChatErrorState {
  message: string;
  kind?: string;
  hint?: string;
}

export default function ChatUI() {
  const auth = useAuth();
  const connectorState = useConnectors();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ChatErrorState | null>(null);
  const [dataSource, setDataSource] = useState<DataSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const conversationRequestRef = useRef(0);
  const previousConnectionRef = useRef(connectorState.selectedConnectionId);
  const suppressConnectionResetRef = useRef<string | null>(null);
  function nextSeq() {
    return ++seqRef.current;
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const selected = connectorState.selectedConnectionId;
    if (selected === previousConnectionRef.current) return;
    previousConnectionRef.current = selected;
    if (selected && suppressConnectionResetRef.current === selected) {
      suppressConnectionResetRef.current = null;
      return;
    }
    setConversationId(undefined);
    setMessages([]);
    setDataSource(null);
    setError(null);
  }, [connectorState.selectedConnectionId]);

  const canChat =
    auth.user && hasPermission(auth.user.role, 'chat' as Permission);
  const hasDataSource =
    connectorState.demoMode || connectorState.connectedConnectors.length > 0;

  async function sendMessage(text: string) {
    if (!canChat || !hasDataSource || connectorState.loading) return;
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
        body: JSON.stringify({
          message: trimmed,
          conversationId,
          connectionId: connectorState.selectedConnectionId ?? undefined,
        }),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
          kind?: string;
          hint?: string;
        };
        setError({
          message: errBody.error ?? `HTTP ${res.status}`,
          kind: errBody.kind,
          hint: errBody.hint,
        });
        return;
      }

      const data = (await res.json()) as {
        reply: string;
        toolsUsed: ToolCall[];
        conversationId: string;
        dataSource: DataSource;
        abstention?: Abstention;
      };
      if (data.conversationId) setConversationId(data.conversationId);
      setDataSource(data.dataSource);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.reply,
        toolsUsed: data.toolsUsed,
        abstention: data.abstention,
        seq: nextSeq(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : 'Error desconocido',
      });
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  function handleSelectConversation(id: string | undefined) {
    const requestId = ++conversationRequestRef.current;
    setConversationId(id);
    setError(null);
    if (!id) {
      setIsLoading(false);
      setMessages([]);
      setDataSource(null);
    } else {
      setIsLoading(true);
      void loadConversation(id)
        .then((result) => {
          if (requestId !== conversationRequestRef.current) return;
          if (result) {
            if (
              result.connectionId &&
              result.connectionId !== connectorState.selectedConnectionId
            ) {
              suppressConnectionResetRef.current = result.connectionId;
              connectorState.selectConnection(result.connectionId);
            }
          const withSeq = result.messages.map((m, i) => ({ ...m, seq: i }));
          setMessages(withSeq);
          } else {
            setError({ message: 'No se pudo cargar la conversación.' });
          }
        })
        .catch((caught) => {
          if (requestId === conversationRequestRef.current) {
            setError({
              message:
                caught instanceof Error
                  ? caught.message
                  : 'No se pudo cargar la conversación.',
            });
          }
        })
        .finally(() => {
          if (requestId === conversationRequestRef.current) setIsLoading(false);
        });
    }
  }

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-inset ring-cyan-300/15">
          <ChatBubbleLeftRightIcon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Chat del Copilot</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Diagnóstico contextual sobre la red activa
          </p>
        </div>
        </div>
        <span
          className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold sm:inline-flex"
          style={{
            borderColor: hasDataSource
              ? 'color-mix(in srgb, var(--color-success) 30%, transparent)'
              : 'color-mix(in srgb, var(--color-warning) 30%, transparent)',
            background: hasDataSource
              ? 'color-mix(in srgb, var(--color-success) 8%, transparent)'
              : 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
            color: hasDataSource ? 'var(--color-success)' : 'var(--color-warning)',
            fontFamily: 'var(--font-display)',
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: hasDataSource ? 'var(--color-success)' : 'var(--color-warning)',
            }}
          />
          {connectorState.loading
            ? 'Comprobando'
            : hasDataSource
              ? 'Disponible'
              : 'Requiere NMS'}
        </span>
      </header>

      <div className="flex flex-col lg:flex-row">
        <HistorySidebar
          currentConversationId={conversationId}
          onSelectConversation={handleSelectConversation}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-5">
          <div
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-busy={isLoading}
            aria-label="Mensajes de la conversación"
            className="card-soft flex min-h-[420px] max-h-[66vh] flex-col gap-4 overflow-y-auto p-4 sm:min-h-[500px] sm:p-5"
          >
            {messages.length === 0 ? (
              <EmptyState
                disabled={isLoading || !canChat || !hasDataSource || connectorState.loading}
                unauthenticated={!auth.user}
                needsConnector={
                  Boolean(auth.user) &&
                  !connectorState.loading &&
                  !hasDataSource
                }
                onPick={(q) => void sendMessage(q)}
              />
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
            {isLoading && (
              <div className="flex items-center gap-2 px-1 text-sm" style={{ color: 'var(--color-muted)' }}>
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--color-accent)' }} />
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:150ms]" style={{ background: 'var(--color-accent)' }} />
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:300ms]" style={{ background: 'var(--color-accent)' }} />
                <span className="ml-1 text-xs" style={{ opacity: 0.6 }}>
                  Analizando tu red…
                </span>
              </div>
            )}
          </div>

          {!canChat && auth.user && (
            <div
              className="flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm"
              style={{
                border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
                background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
                color: 'var(--color-warning)',
              }}
            >
              <CommandLineIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>Modo de solo lectura: no tenés permiso para enviar mensajes.</span>
            </div>
          )}

          {dataSource && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg px-3.5 py-2.5 text-sm"
              style={{
                border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)',
                background: 'color-mix(in srgb, var(--color-success) 8%, transparent)',
                color: 'var(--color-success)',
              }}
            >
              {dataSource.mode === 'demo' ? 'Datos simulados' : 'Datos reales'} ·{' '}
              {dataSource.label}
            </div>
          )}

          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="flex flex-col gap-1.5 rounded-lg px-3.5 py-2.5 text-sm"
              style={{
                border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)',
                background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)',
                color: 'var(--color-text)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span>{error.message}</span>
                {error.kind && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider"
                    style={{
                      background: 'color-mix(in srgb, var(--color-danger) 15%, transparent)',
                      color: 'var(--color-danger)',
                    }}
                  >
                    {error.kind}
                  </span>
                )}
              </div>
              {error.hint && (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  <span className="font-semibold" style={{ color: 'var(--color-text)' }}>Sugerencia:</span> {error.hint}
                </p>
              )}
            </div>
          )}

          {canChat && (
            <form onSubmit={handleSubmit} className="card-soft flex gap-2 p-2">
              <input
                type="text"
                name="network-question"
                autoComplete="off"
                aria-label="Pregunta para el Copilot"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  connectorState.loading
                    ? 'Comprobando fuentes de datos…'
                    : hasDataSource
                      ? 'Preguntale algo a tu red…'
                      : 'Configurá y validá un conector NMS para comenzar'
                }
                disabled={isLoading || connectorState.loading || !hasDataSource}
                className="input border-transparent bg-transparent shadow-none hover:border-transparent focus:border-transparent focus:bg-transparent focus:shadow-none"
              />
              <button
                type="submit"
                disabled={isLoading || connectorState.loading || !hasDataSource || !input.trim()}
                className="btn-primary min-h-10 shrink-0 px-3.5 sm:px-4"
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
  unauthenticated,
  needsConnector,
  onPick,
}: {
  disabled: boolean;
  unauthenticated: boolean;
  needsConnector: boolean;
  onPick: (q: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-7 text-center sm:py-10">
      <span
        className="relative flex h-16 w-16 items-center justify-center rounded-[1.25rem]"
        style={{
          border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
          background: 'linear-gradient(135deg, rgb(242 48 119 / 0.15), rgb(242 48 119 / 0.05))',
          color: 'var(--color-accent)',
          boxShadow: '0 18px 45px rgb(242 48 119 / 0.12)',
        }}
      >
        <span
          className="absolute inset-2 rounded-xl"
          style={{ border: '1px solid color-mix(in srgb, var(--color-text) 5%, transparent)' }}
        />
        <SparklesIcon className="relative h-7 w-7" />
      </span>
      <div className="space-y-1">
        <h3
          className="text-base font-semibold tracking-[-0.02em] sm:text-lg"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}>
          {unauthenticated
            ? 'Iniciá sesión para consultar tu red'
            : needsConnector
              ? 'Conectá tu NMS para comenzar'
              : 'Hacé tu primera pregunta'}
        </h3>
        <p
          className="mx-auto max-w-md text-sm leading-6"
          style={{ color: 'var(--color-muted)' }}>
          {unauthenticated
            ? 'Tus conversaciones y datos de red están protegidos por tu cuenta.'
            : needsConnector
              ? 'Agregá SmartOLT o Mikrowisp y validá las credenciales. El chat se habilitará automáticamente cuando la prueba sea exitosa.'
              : 'Tu Copilot consulta el NMS seleccionado. Probá con una de estas preguntas:'}
        </p>
      </div>
      {needsConnector && (
        <a href="#gestion" className="btn-primary">
          Configurar conector NMS
        </a>
      )}
      <div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q.text}
            type="button"
            onClick={() => onPick(q.text)}
            disabled={disabled}
            className="group flex items-start gap-3 rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
            style={{
              borderColor: 'var(--border-divider)',
              background: 'color-mix(in srgb, var(--color-muted) 5%, transparent)',
            }}
          >
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
              style={{
                background: `color-mix(in srgb, ${q.tint} 10%, transparent)`,
                border: `1px solid color-mix(in srgb, ${q.tint} 30%, transparent)`,
                color: q.tint,
              }}
            >
              <q.Icon className="h-4 w-4" />
            </span>
            <span
              className="flex-1 text-xs font-medium leading-5 sm:text-sm"
              style={{ color: 'var(--color-text)' }}>
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
  // The synthetic `__abstention__` tool row (Phase 3) drives the warning
  // bubble. We hide it from the chip list so operators only see the real
  // tool calls the agent attempted.
  const abstentionRow = message.toolsUsed?.find(
    (t) => t.name === ABSTENTION_PSEUDO_TOOL,
  );
  const abstentionFromRow =
    abstentionRow && typeof abstentionRow === 'object'
      ? ((abstentionRow as unknown as { args?: { mode?: unknown } }).args as
          | { mode?: unknown }
          | undefined)
      : undefined;
  const effectiveAbstention = message.abstention;
  const visibleTools = message.toolsUsed?.filter(
    (t) => t.name !== ABSTENTION_PSEUDO_TOOL,
  );
  const showAbstentionBubble = !!abstentionRow || !!effectiveAbstention;
  // Suppress the unused-variable warning when neither field is set — the
  // bubble trigger ignores the `mode` arg today, but the row carries it for
  // future per-tool filtering.
  void abstentionFromRow;
  return (
    <div
      className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}
    >
      {visibleTools && visibleTools.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <CommandLineIcon className="h-3.5 w-3.5" />
          <span className="font-medium">Herramientas:</span>
          {visibleTools.map((t, i) => (
            <span
              key={i}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-0.5 font-mono text-[11px] text-neutral-400"
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
      {showAbstentionBubble && effectiveAbstention && (
        <AbstentionBubble abstention={effectiveAbstention} />
      )}
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
          isUser
            ? 'rounded-br-md bg-gradient-to-br from-cyan-500 to-cyan-600 text-[#031018] shadow-cyan-500/10'
            : 'rounded-bl-md border border-white/[0.07] bg-white/[0.035] text-neutral-100'
        }`}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}

/**
 * Phase 3 warning bubble rendered when the agent abstained in strict
 * mode (Fase C). The bubble is keyed off the `abstention` envelope —
 * either forwarded live on the `/api/chat` response body or
 * reconstructed from the persisted `__abstention__` row in history.
 *
 * Style matches the existing `text-amber-*` warning tint used by the
 * data-source banner and the read-only notice, so the operator sees
 * one consistent warning visual across the surface.
 */
function AbstentionBubble({ abstention }: { abstention: Abstention }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="abstention-bubble"
      className="flex w-full max-w-[88%] flex-col gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-amber-200"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-300">
        <span aria-hidden="true">🔒</span>
        No se pudo respaldar el diagnóstico
      </h3>
      {abstention.missing.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-amber-300/80">
            Falta evidencia de
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] leading-5 text-amber-100">
            {abstention.missing.map((toolName) => (
              <li key={toolName} className="font-mono">
                {toolName}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[13px] leading-5 text-amber-100">
        {abstention.nextStep}
      </p>
    </div>
  );
}
