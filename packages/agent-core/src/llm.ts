/**
 * LLM abstraction with three provider implementations:
 *  - AnthropicStyleClient: MiniMax (Anthropic API-compatible).
 *  - OpenAIStyleClient: DeepSeek and Qwen (OpenAI-compatible).
 *
 * Use `createLlmClient` to get a client from the env configuration, or
 * `withFallback` to wrap a list of clients in a fallback chain.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
}

export interface LlmClient {
  readonly provider: string;
  createMessage(req: LlmRequest): Promise<LlmResponse>;
}

/* ---------- Anthropic-compatible (MiniMax) ---------- */

class AnthropicStyleClient implements LlmClient {
  readonly provider = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: { apiKey: string; baseURL?: string; model: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model;
  }

  async createMessage(req: LlmRequest): Promise<LlmResponse> {
    const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const tools: Anthropic.Tool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: { ...t.inputSchema, type: 'object' as const },
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 2048,
      system: req.system,
      tools,
      messages,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    const toolCalls: LlmToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ name: b.name, arguments: (b.input ?? {}) as Record<string, unknown> }));

    return { text: text || '(sin respuesta)', toolCalls };
  }
}

/* ---------- OpenAI-compatible (DeepSeek / Qwen) ---------- */

class OpenAIStyleClient implements LlmClient {
  readonly provider: string;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(opts: { apiKey: string; baseURL: string; model: string; provider: string }) {
    this.provider = opts.provider;
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model;
  }

  async createMessage(req: LlmRequest): Promise<LlmResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: req.system },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const tools: OpenAI.ChatCompletionTool[] = req.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: { ...t.inputSchema, type: 'object' as const },
      },
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 2048,
      messages,
      tools,
      tool_choice: 'auto',
    });

    const choice = response.choices[0];
    const message = choice?.message;
    const text = message?.content ?? '';
    const toolCalls: LlmToolCall[] = (message?.tool_calls ?? []).map((tc) => ({
      name: tc.function.name,
      arguments: parseJsonSafe(tc.function.arguments),
    }));

    return { text, toolCalls };
  }
}

function parseJsonSafe(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/* ---------- Fallback ---------- */

/**
 * Wraps a list of clients. Tries each in order; if one throws a transient
 * error (network, rate limit, timeout, 5xx), moves to the next. Non-transient
 * errors (4xx validation) propagate immediately — those are coding bugs, not
 * provider outages.
 */
export class FallbackLlmClient implements LlmClient {
  readonly provider: string;
  private readonly clients: LlmClient[];

  constructor(clients: LlmClient[]) {
    if (clients.length === 0) {
      throw new Error('FallbackLlmClient requires at least one client');
    }
    this.clients = clients;
    this.provider = `fallback(${clients.map((c) => c.provider).join('→')})`;
  }

  async createMessage(req: LlmRequest): Promise<LlmResponse> {
    const errors: unknown[] = [];
    for (const client of this.clients) {
      try {
        return await client.createMessage(req);
      } catch (err) {
        if (!isTransientError(err)) throw err;
        errors.push(err);
      }
    }
    const messages = errors.map((e) => (e instanceof Error ? e.message : String(e)));
    throw new Error(
      `Todos los proveedores LLM fallaron (${this.clients.map((c) => c.provider).join(', ')}): ${messages.join(' | ')}`,
    );
  }
}

export function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Network / DNS / connect / timeout — POSIX errno names that indicate the
  // provider is unreachable right now, not a code bug on our side.
  if (
    /\betimedout\b/.test(msg) || // connect/read timeout
    /\beconnrefused\b/.test(msg) ||
    /\benotfound\b/.test(msg) ||
    /\beconnreset\b/.test(msg) ||
    /\behostunreach\b/.test(msg) ||
    msg.includes('socket hang up') ||
    msg.includes('fetch failed')
  ) {
    return true;
  }
  // HTTP status codes that mean "try the next provider"
  if (
    /\b429\b/.test(msg) || // rate limit
    /\b5\d\d\b/.test(msg)    // 5xx server error
  ) {
    return true;
  }
  return false;
}

/* ---------- Factory ---------- */

export interface LlmClientConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseURL: string;
}

export function readLlmConfig(): LlmClientConfig[] {
  // Resolve a list of providers in fallback order. Provider name → env keys.
  // LLM_FALLBACK takes precedence over LLM_PROVIDER; if neither is set we
  // return an empty array so the caller can fail fast (better than silently
  // defaulting to a provider the operator never asked for).
  const raw = process.env['LLM_FALLBACK'] ?? process.env['LLM_PROVIDER'];
  if (!raw) return [];
  const providers = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (providers.length === 0) return [];

  const configs: LlmClientConfig[] = [];
  for (const name of providers) {
    const cfg = readSingleConfig(name);
    if (cfg) configs.push(cfg);
  }
  return configs;
}

function readSingleConfig(name: string): LlmClientConfig | null {
  switch (name) {
    case 'minimax': {
      const apiKey = process.env['MINIMAX_API_KEY'];
      const model = process.env['MINIMAX_MODEL'] ?? 'MiniMax-M3';
      const baseURL = process.env['MINIMAX_BASE_URL'] ?? 'https://api.minimax.io/anthropic';
      if (!apiKey) return null;
      return { provider: 'minimax', apiKey, model, baseURL };
    }
    case 'deepseek': {
      const apiKey = process.env['DEEPSEEK_API_KEY'];
      const model = process.env['DEEPSEEK_MODEL'] ?? 'deepseek-chat';
      const baseURL = process.env['DEEPSEEK_BASE_URL'] ?? 'https://api.deepseek.com/v1';
      if (!apiKey) return null;
      return { provider: 'deepseek', apiKey, model, baseURL };
    }
    case 'qwen': {
      const apiKey = process.env['QWEN_API_KEY'];
      const model = process.env['QWEN_MODEL'] ?? 'qwen-plus';
      const baseURL =
        process.env['QWEN_BASE_URL'] ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      if (!apiKey) return null;
      return { provider: 'qwen', apiKey, model, baseURL };
    }
    default:
      return null;
  }
}

/**
 * Creates a single client from config.
 */
export function createClient(cfg: LlmClientConfig): LlmClient {
  if (cfg.provider === 'minimax') {
    return new AnthropicStyleClient({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      model: cfg.model,
    });
  }
  return new OpenAIStyleClient({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
    model: cfg.model,
    provider: cfg.provider,
  });
}

/**
 * Creates an LLM client based on env configuration. If multiple providers are
 * configured (`LLM_FALLBACK=minimax,deepseek,qwen`), wraps them in a
 * FallbackLlmClient that tries each in order.
 */
export function createLlmClient(): LlmClient {
  const configs = readLlmConfig();
  if (configs.length === 0) {
    throw new Error(
      'No hay proveedor LLM configurado. Definí LLM_PROVIDER (minimax|deepseek|qwen) o LLM_FALLBACK=minimax,deepseek,qwen en el .env con sus API keys.',
    );
  }
  if (configs.length === 1) {
    return createClient(configs[0]!);
  }
  return new FallbackLlmClient(configs.map(createClient));
}
