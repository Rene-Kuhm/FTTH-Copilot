import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INmsConnector } from '@ftth-copilot/connectors-core';
import { evidenceProvenanceSchema, EVIDENCE_PROVENANCE_SCHEMA } from '@ftth-copilot/shared';

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
      tenantId: 't1',
      connectionId: 'conn-1',
    });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.text).toContain('[DEMO]');
    expect(createMessage.mock.calls[0]?.[0].system).toContain('DATOS SIMULADOS');
    expect(createMessage.mock.calls[1]?.[0].messages).toHaveLength(3);

    // Provenance envelope under toolCalls[].result with tenantId threaded through
    const toolResult = result.toolCalls[0]?.result;
    expect(typeof toolResult).toBe('string');
    const envelope = JSON.parse(toolResult as string) as Record<string, unknown>;
    const parsed = evidenceProvenanceSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
    expect(envelope.schema).toBe(EVIDENCE_PROVENANCE_SCHEMA);
    expect(envelope.tenantId).toBe('t1');
    expect(envelope.source).toBe('smartolt.demo');
  });

  it('threads tenantId in live mode with .poll source', async () => {
    createMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'list_olts', arguments: {} }],
      })
      .mockResolvedValueOnce({ text: 'resultado', toolCalls: [] });
    const result = await runAgent({
      userMessage: 'listar',
      connector,
      dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
      tenantId: 't1',
    });
    const toolResult = result.toolCalls[0]?.result;
    const envelope = JSON.parse(toolResult as string) as Record<string, unknown>;
    expect(envelope.tenantId).toBe('t1');
    expect(envelope.source).toBe('smartolt.poll');
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

  it('attaches a verdict per tool call to AgentResult.verdicts', async () => {
    createMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { name: 'list_olts', arguments: {} },
          { name: 'get_network_overview', arguments: {} },
          { name: 'get_olt_detail', arguments: { oltId: 'OLT-001' } },
        ],
      })
      .mockResolvedValueOnce({ text: 'final', toolCalls: [] });
    const result = await runAgent({
      userMessage: 'multi',
      connector,
      dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
      tenantId: 't1',
    });
    expect(result.verdicts).toBeDefined();
    expect(result.verdicts).toHaveLength(3);
    for (const verdict of result.verdicts ?? []) {
      expect(typeof verdict.toolName).toBe('string');
      expect(verdict.toolName.length).toBeGreaterThan(0);
    }
    expect(result.verdicts?.[0]?.toolName).toBe('list_olts');
    expect(result.verdicts?.[1]?.toolName).toBe('get_network_overview');
    expect(result.verdicts?.[2]?.toolName).toBe('get_olt_detail');
    // toolCalls and text unchanged
    expect(result.toolCalls).toHaveLength(3);
    expect(result.text).toBe('final');
  });
});
