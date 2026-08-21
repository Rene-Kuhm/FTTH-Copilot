import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INmsConnector } from '@ftth-copilot/connectors-core';

const createMessage = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = { create: createMessage };
  },
}));

import { runAgent } from '../src/runtime';

const connector = {
  providerName: 'test',
  listOlts: vi.fn(async () => []),
} as unknown as INmsConnector;

beforeEach(() => {
  process.env['MINIMAX_API_KEY'] = 'test-key';
  createMessage.mockReset();
});

afterEach(() => {
  delete process.env['MINIMAX_API_KEY'];
});

describe('runAgent', () => {
  it('returns a direct model response with history and live-source context', async () => {
    createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'respuesta' }] });
    const result = await runAgent({
      userMessage: 'seguí',
      conversationHistory: [{ role: 'user', content: 'contexto anterior' }],
      connector,
      dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
    });
    expect(result.text).toBe('respuesta');
    expect(createMessage.mock.calls[0]?.[0].messages).toHaveLength(2);
    expect(createMessage.mock.calls[0]?.[0].system).toContain('Producción');
  });

  it('executes tool calls and marks demo mode in the system prompt', async () => {
    createMessage
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'list_olts', input: {} }],
      })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '[DEMO] resultado' }] });
    const result = await runAgent({
      userMessage: 'listar',
      connector,
      dataSource: { mode: 'demo', provider: 'SMARTOLT', label: 'Demo' },
    });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.text).toContain('[DEMO]');
    expect(createMessage.mock.calls[0]?.[0].system).toContain('DATOS SIMULADOS');
    expect(createMessage.mock.calls[1]?.[0].messages).toHaveLength(3);
  });

  it('fails closed when the provider key is absent', async () => {
    delete process.env['MINIMAX_API_KEY'];
    await expect(runAgent({ userMessage: 'hola', connector })).rejects.toThrow('MINIMAX_API_KEY');
  });

  it('stops a tool loop at the configured iteration limit', async () => {
    createMessage.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tool-loop', name: 'list_olts', input: {} }],
    });
    const result = await runAgent({ userMessage: 'loop', connector, maxIterations: 1 });
    expect(result.text).toMatch(/excedió/);
  });
});
