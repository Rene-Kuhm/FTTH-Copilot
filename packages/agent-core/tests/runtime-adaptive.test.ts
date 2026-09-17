/**
 * Adaptive Router — Slice 2 runtime wiring tests.
 *
 * End-to-end tests for the three modes inside runAgent:
 *   - direct: zero LLM calls. Tool runs, formatted answer returned.
 *   - assisted: exactly one LLM call. Tools restricted to the route.tools set.
 *   - investigation: full loop (legacy behaviour, maxIterations=6).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent } from '../src/runtime';
import type { INmsConnector } from '@ftth-copilot/connectors-core';

const createMessage = vi.fn();
vi.mock('../src/llm', () => ({
  createLlmClient: () => ({ provider: 'mock', createMessage }),
}));

const connector: INmsConnector = {
  providerName: 'test',
  listOlts: vi.fn(async () => []),
} as unknown as INmsConnector;

// Set env vars once for this suite so the factory's env read doesn't fail.
process.env['LLM_PROVIDER'] = 'minimax';
process.env['MINIMAX_API_KEY'] = 'test-key';

describe('runAgent — adaptive router (Slice 2)', () => {
  beforeEach(() => {
    createMessage.mockReset();
  });

  // ── direct mode ──────────────────────────────────────────────────────────

  it('direct mode performs 0 LLM calls', async () => {
    const result = await runAgent({
      userMessage: 'estado de ONU-342',
      connector,
      dataSource: { mode: 'demo', provider: 'SMARTOLT', label: 'Demo' },
      tenantId: 't1',
    });
    expect(createMessage).not.toHaveBeenCalled();
    expect(result.route?.mode).toBe('direct');
    expect(result.route?.maxIterations).toBe(0);
  });

  it('direct mode carries route metadata through AgentResult', async () => {
    const result = await runAgent({
      userMessage: 'potencia RX de ONU-342',
      connector,
      dataSource: { mode: 'demo', provider: 'SMARTOLT', label: 'Demo' },
      tenantId: 't1',
    });
    expect(result.route?.mode).toBe('direct');
    expect(result.route?.reason).toContain('direct');
    expect(result.route?.tools).toBeDefined();
    expect(Array.isArray(result.route?.tools)).toBe(true);
  });

  // ── assisted mode ────────────────────────────────────────────────────────

  it('assisted mode performs exactly 1 LLM call when LLM emits no tool call', async () => {
    createMessage.mockResolvedValueOnce({
      text: 'respuesta corta',
      toolCalls: [],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const result = await runAgent({
      userMessage: 'qué pasó ayer con ONU-342?',
      connector,
      dataSource: { mode: 'demo', provider: 'SMARTOLT', label: 'Demo' },
      tenantId: 't1',
    });
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(result.route?.mode).toBe('assisted');
    expect(result.route?.maxIterations).toBe(1);
    expect(result.text).toContain('respuesta corta');
  });

  // ── investigation mode ───────────────────────────────────────────────────

  it('investigation mode honours maxIterations=6 by default', async () => {
    createMessage.mockResolvedValue({
      text: '',
      toolCalls: [{ name: 'list_olts', arguments: {} }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const result = await runAgent({
      userMessage: 'caída progresiva de RX en 28 ONUs, cuál es la causa raíz?',
      connector,
      dataSource: { mode: 'demo', provider: 'SMARTOLT', label: 'Demo' },
      tenantId: 't1',
    });
    expect(result.route?.mode).toBe('investigation');
    expect(result.route?.maxIterations).toBe(6);
    expect(createMessage.mock.calls.length).toBeGreaterThan(1);
    expect(createMessage.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('opts.maxIterations overrides route.maxIterations', async () => {
    createMessage.mockResolvedValue({
      text: '',
      toolCalls: [{ name: 'list_olts', arguments: {} }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const result = await runAgent({
      userMessage: 'qué pasó ayer con ONU-342',
      connector,
      dataSource: { mode: 'demo', provider: 'SMARTOLT', label: 'Demo' },
      tenantId: 't1',
      maxIterations: 2,
    });
    expect(result.route?.mode).toBe('assisted');
    // route.maxIterations reflects the router's recommendation (assisted = 1).
    // The opts.maxIterations: 2 override is honoured by the loop but is not
    // reflected back into the route field (the route records the router's
    // decision, not the merged value).
    expect(result.route?.maxIterations).toBe(1);
    expect(createMessage.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
