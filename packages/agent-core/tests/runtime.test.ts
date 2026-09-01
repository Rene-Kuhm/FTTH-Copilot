import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INmsConnector } from '@ftth-copilot/connectors-core';

const createMessage = vi.hoisted(() => vi.fn());

// Mock the LLM factory so tests can drive the responses deterministically.
vi.mock('../src/llm', () => ({
  createLlmClient: () => ({ provider: 'mock', createMessage }),
}));

import { runAgent } from '../src/runtime';

const connector = {
  providerName: 'test',
  listOlts: vi.fn(async () => []),
} as unknown as INmsConnector;

beforeEach(() => {
  process.env['LLM_PROVIDER'] = 'minimax';
  process.env['MINIMAX_API_KEY'] = 'test-key';
  createMessage.mockReset();
});

afterEach(() => {
  delete process.env['LLM_PROVIDER'];
  delete process.env['MINIMAX_API_KEY'];
});

describe('runAgent', () => {
  it('returns a direct model response with history and live-source context', async () => {
    createMessage.mockResolvedValueOnce({ text: 'respuesta', toolCalls: [] });
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
        text: '',
        toolCalls: [{ name: 'list_olts', arguments: {} }],
      })
      .mockResolvedValueOnce({ text: '[DEMO] resultado', toolCalls: [] });
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

  it('fails closed when the LLM factory raises', async () => {
    createMessage.mockImplementationOnce(async () => {
      throw new Error('No hay proveedor LLM configurado. Definí LLM_PROVIDER en el .env.');
    });
    await expect(runAgent({ userMessage: 'hola', connector })).rejects.toThrow(
      /No hay proveedor LLM/,
    );
  });

  it('stops a tool loop at the configured iteration limit', async () => {
    createMessage.mockResolvedValue({
      text: '',
      toolCalls: [{ name: 'list_olts', arguments: {} }],
    });
    const result = await runAgent({ userMessage: 'loop', connector, maxIterations: 1 });
    expect(result.text).toMatch(/excedió/);
  });
});
