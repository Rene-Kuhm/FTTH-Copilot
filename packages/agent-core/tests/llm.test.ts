import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import {
  FallbackLlmClient,
  createClient,
  createLlmClient,
  isTransientError,
  readLlmConfig,
  type LlmClient,
  type LlmRequest,
} from '../src/llm';

function fakeClient(provider: string, behavior: (req: LlmRequest) => Promise<unknown>): LlmClient {
  return {
    provider,
    createMessage: vi.fn(behavior),
  };
}

const SAMPLE_REQUEST: LlmRequest = {
  system: 'you are a test',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [
    {
      name: 'noop',
      description: 'do nothing',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  maxTokens: 128,
};

describe('createClient', () => {
  it('returns an AnthropicStyleClient for minimax', () => {
    const prev = process.env['MINIMAX_API_KEY'];
    process.env['MINIMAX_API_KEY'] = 'test-key';
    try {
      const client = createClient({
        provider: 'minimax',
        apiKey: 'test-key',
        model: 'MiniMax-M3',
        baseURL: 'https://api.minimax.io/anthropic',
      });
      expect(client.provider).toBe('anthropic');
    } finally {
      if (prev === undefined) delete process.env['MINIMAX_API_KEY'];
      else process.env['MINIMAX_API_KEY'] = prev;
    }
  });

  it('returns an OpenAIStyleClient for deepseek', () => {
    const client = createClient({
      provider: 'deepseek',
      apiKey: 'ds-key',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
    });
    expect(client.provider).toBe('deepseek');
  });

  it('returns an OpenAIStyleClient for qwen', () => {
    const client = createClient({
      provider: 'qwen',
      apiKey: 'qwen-key',
      model: 'qwen-plus',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    expect(client.provider).toBe('qwen');
  });
});

describe('readLlmConfig', () => {
  it('returns minimax config when LLM_PROVIDER=minimax and key set', () => {
    const prev = process.env['LLM_PROVIDER'];
    const prevKey = process.env['MINIMAX_API_KEY'];
    process.env['LLM_PROVIDER'] = 'minimax';
    process.env['MINIMAX_API_KEY'] = 'key';
    try {
      const cfgs = readLlmConfig();
      expect(cfgs).toHaveLength(1);
      expect(cfgs[0]).toMatchObject({ provider: 'minimax', apiKey: 'key' });
    } finally {
      if (prev === undefined) delete process.env['LLM_PROVIDER'];
      else process.env['LLM_PROVIDER'] = prev;
      if (prevKey === undefined) delete process.env['MINIMAX_API_KEY'];
      else process.env['MINIMAX_API_KEY'] = prevKey;
    }
  });

  it('returns deepseek config when LLM_FALLBACK contains deepseek with key', () => {
    const prev = process.env['LLM_FALLBACK'];
    const prevKey = process.env['DEEPSEEK_API_KEY'];
    process.env['LLM_FALLBACK'] = 'deepseek';
    process.env['DEEPSEEK_API_KEY'] = 'ds-key';
    try {
      const cfgs = readLlmConfig();
      expect(cfgs).toHaveLength(1);
      expect(cfgs[0]).toMatchObject({ provider: 'deepseek', apiKey: 'ds-key' });
    } finally {
      if (prev === undefined) delete process.env['LLM_FALLBACK'];
      else process.env['LLM_FALLBACK'] = prev;
      if (prevKey === undefined) delete process.env['DEEPSEEK_API_KEY'];
      else process.env['DEEPSEEK_API_KEY'] = prevKey;
    }
  });

  it('skips providers without API keys', () => {
    const prev = process.env['LLM_FALLBACK'];
    const prevKey = process.env['DEEPSEEK_API_KEY'];
    process.env['LLM_FALLBACK'] = 'deepseek,minimax';
    process.env['MINIMAX_API_KEY'] = 'minimax-key';
    delete process.env['DEEPSEEK_API_KEY'];
    try {
      const cfgs = readLlmConfig();
      expect(cfgs).toHaveLength(1);
      expect(cfgs[0]?.provider).toBe('minimax');
    } finally {
      if (prev === undefined) delete process.env['LLM_FALLBACK'];
      else process.env['LLM_FALLBACK'] = prev;
      if (prevKey === undefined) delete process.env['DEEPSEEK_API_KEY'];
      else process.env['DEEPSEEK_API_KEY'] = prevKey;
    }
  });

  it('returns empty array when no providers configured', () => {
    const prev = process.env['LLM_PROVIDER'];
    const prevFallback = process.env['LLM_FALLBACK'];
    delete process.env['LLM_PROVIDER'];
    delete process.env['LLM_FALLBACK'];
    try {
      expect(readLlmConfig()).toEqual([]);
    } finally {
      if (prev !== undefined) process.env['LLM_PROVIDER'] = prev;
      if (prevFallback !== undefined) process.env['LLM_FALLBACK'] = prevFallback;
    }
  });
});

describe('createLlmClient', () => {
  it('throws when no providers configured', () => {
    const prev = process.env['LLM_PROVIDER'];
    const prevFallback = process.env['LLM_FALLBACK'];
    delete process.env['LLM_PROVIDER'];
    delete process.env['LLM_FALLBACK'];
    try {
      expect(() => createLlmClient()).toThrow(/No hay proveedor LLM/);
    } finally {
      if (prev !== undefined) process.env['LLM_PROVIDER'] = prev;
      if (prevFallback !== undefined) process.env['LLM_FALLBACK'] = prevFallback;
    }
  });

  it('wraps multiple providers in FallbackLlmClient', () => {
    // Reset all and set only deepseek + qwen keys.
    const prev = process.env['LLM_PROVIDER'];
    const prevFallback = process.env['LLM_FALLBACK'];
    const prevDs = process.env['DEEPSEEK_API_KEY'];
    const prevQw = process.env['QWEN_API_KEY'];
    process.env['LLM_FALLBACK'] = 'deepseek,qwen';
    process.env['DEEPSEEK_API_KEY'] = 'ds-key';
    process.env['QWEN_API_KEY'] = 'qwen-key';
    delete process.env['MINIMAX_API_KEY'];
    try {
      const client = createLlmClient();
      expect(client.provider).toContain('fallback');
      expect(client.provider).toContain('deepseek');
      expect(client.provider).toContain('qwen');
    } finally {
      if (prev !== undefined) process.env['LLM_PROVIDER'] = prev;
      if (prevFallback !== undefined) process.env['LLM_FALLBACK'] = prevFallback;
      else delete process.env['LLM_FALLBACK'];
      if (prevDs === undefined) delete process.env['DEEPSEEK_API_KEY'];
      else process.env['DEEPSEEK_API_KEY'] = prevDs;
      if (prevQw === undefined) delete process.env['QWEN_API_KEY'];
      else process.env['QWEN_API_KEY'] = prevQw;
    }
  });
});

describe('isTransientError', () => {
  it.each([
    ['network timeout', new Error('connect ETIMEDOUT')],
    ['dns failure', new Error('getaddrinfo ENOTFOUND api.deepseek.com')],
    ['connection refused', new Error('connect ECONNREFUSED 127.0.0.1:443')],
    ['connection reset', new Error('read ECONNRESET')],
    ['socket hang up', new Error('socket hang up')],
    ['fetch failed', new Error('fetch failed')],
    ['rate limit 429', new Error('429 Too Many Requests')],
    ['server error 500', new Error('500 Internal Server Error')],
    ['server error 503', new Error('503 Service Unavailable')],
  ])('treats %s as transient', (_label, err) => {
    expect(isTransientError(err)).toBe(true);
  });

  it.each([
    ['plain Error', new Error('oh no')],
    ['validation 400', new Error('400 Bad Request')],
    ['auth 401', new Error('401 Unauthorized')],
    ['not found 404', new Error('404 Not Found')],
  ])('treats %s as non-transient', (_label, err) => {
    expect(isTransientError(err)).toBe(false);
  });

  it('treats non-Error values as non-transient', () => {
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError('a string')).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});

describe('FallbackLlmClient', () => {
  it('throws when constructed with no clients', () => {
    expect(() => new FallbackLlmClient([])).toThrow(/at least one/);
  });

  it('uses the first client when it succeeds', async () => {
    const a = fakeClient('a', async () => ({ text: 'A', toolCalls: [] }));
    const b = fakeClient('b', async () => ({ text: 'B', toolCalls: [] }));
    const client = new FallbackLlmClient([a, b]);
    const result = await client.createMessage(SAMPLE_REQUEST);
    expect(result.text).toBe('A');
    expect(a.createMessage).toHaveBeenCalledTimes(1);
    expect(b.createMessage).not.toHaveBeenCalled();
  });

  it('falls back to the next client on a transient error', async () => {
    const a = fakeClient('a', async () => {
      throw new Error('connect ETIMEDOUT');
    });
    const b = fakeClient('b', async () => ({ text: 'B', toolCalls: [] }));
    const client = new FallbackLlmClient([a, b]);
    const result = await client.createMessage(SAMPLE_REQUEST);
    expect(result.text).toBe('B');
    expect(a.createMessage).toHaveBeenCalledTimes(1);
    expect(b.createMessage).toHaveBeenCalledTimes(1);
  });

  it('falls back through all transient failures and aggregates the error', async () => {
    const a = fakeClient('a', async () => {
      throw new Error('connect ETIMEDOUT');
    });
    const b = fakeClient('b', async () => {
      throw new Error('fetch failed');
    });
    const client = new FallbackLlmClient([a, b]);
    await expect(client.createMessage(SAMPLE_REQUEST)).rejects.toThrow(
      /Todos los proveedores LLM fallaron/,
    );
    expect(a.createMessage).toHaveBeenCalledTimes(1);
    expect(b.createMessage).toHaveBeenCalledTimes(1);
  });

  it('propagates non-transient errors immediately', async () => {
    const a = fakeClient('a', async () => {
      throw new Error('400 Bad Request');
    });
    const b = fakeClient('b', async () => ({ text: 'B', toolCalls: [] }));
    const client = new FallbackLlmClient([a, b]);
    await expect(client.createMessage(SAMPLE_REQUEST)).rejects.toThrow(/400 Bad Request/);
    expect(a.createMessage).toHaveBeenCalledTimes(1);
    expect(b.createMessage).not.toHaveBeenCalled();
  });

  it('reports the chain in its provider name', () => {
    const a = fakeClient('minimax', async () => ({ text: 'x', toolCalls: [] }));
    const b = fakeClient('deepseek', async () => ({ text: 'x', toolCalls: [] }));
    const c = fakeClient('qwen', async () => ({ text: 'x', toolCalls: [] }));
    const client = new FallbackLlmClient([a, b, c]);
    expect(client.provider).toBe('fallback(minimax→deepseek→qwen)');
  });
});

// Reference OpenAI import so it's not flagged as unused in case future tests
// exercise the OpenAI client directly.
expect(OpenAI).toBeTypeOf('function');
