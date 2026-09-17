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

const { createMessage, createClient, getOnuDetail, getOltDetail } = vi.hoisted(() => {
  const createMessage = vi.fn();
  return {
    createMessage,
    createClient: vi.fn(() => ({ provider: 'mock', createMessage })),
    getOnuDetail: vi.fn(async (identifier: string) => ({
      id: identifier,
      status: 'online',
      rxPowerDbm: -21.5,
    })),
    getOltDetail: vi.fn(async (oltId: string) => ({
      id: oltId,
      status: 'online',
    })),
  };
});
vi.mock('../src/llm', () => ({
  createLlmClient: createClient,
}));

const connector: INmsConnector = {
  providerName: 'test',
  listOlts: vi.fn(async () => []),
  getOnuDetail,
  getOltDetail,
} as unknown as INmsConnector;

// Set env vars once for this suite so the factory's env read doesn't fail.
process.env['LLM_PROVIDER'] = 'minimax';
process.env['MINIMAX_API_KEY'] = 'test-key';

describe('runAgent — adaptive router (Slice 2)', () => {
  beforeEach(() => {
    createMessage.mockReset();
    createClient.mockClear();
    getOnuDetail.mockClear();
    getOltDetail.mockClear();
  });

  // ── direct mode ──────────────────────────────────────────────────────────

  it('direct mode executes its selected tool and returns a useful answer without initializing the LLM', async () => {
    const result = await runAgent({
      userMessage: 'estado de ONU-342',
      connector,
      dataSource: { mode: 'demo', provider: 'SMARTOLT', label: 'Demo' },
      tenantId: 't1',
      mode: 'observe',
    });

    expect(createClient).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
    expect(getOnuDetail).toHaveBeenCalledOnce();
    expect(getOnuDetail).toHaveBeenCalledWith('ONU-342');
    expect(result.text).toMatch(/^\[DEMO\]/);
    expect(result.text).toContain('ONU-342');
    expect(result.text).not.toContain('excedió');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: 'get_onu_detail',
      arguments: { identifier: 'ONU-342' },
    });
    expect(result.toolCalls[0]?.result).toEqual(expect.any(String));
    expect(result.toolCalls[0]?.durationMs).toEqual(expect.any(Number));
    expect(result.verdicts).toHaveLength(1);
    expect(result.verdicts?.[0]?.toolName).toBe('get_onu_detail');
    expect(result.route?.mode).toBe('direct');
    expect(result.route?.maxIterations).toBe(0);
  });

  it('direct live mode maps an OLT identifier without adding the demo disclosure', async () => {
    const result = await runAgent({
      userMessage: 'estado de OLT-7',
      connector,
      dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Production' },
      tenantId: 't1',
      mode: 'observe',
    });

    expect(getOltDetail).toHaveBeenCalledOnce();
    expect(getOltDetail).toHaveBeenCalledWith('OLT-7');
    expect(result.text).not.toMatch(/^\[DEMO\]/);
    expect(result.toolCalls[0]).toMatchObject({
      name: 'get_olt_detail',
      arguments: { oltId: 'OLT-7' },
    });
  });

  it.each([
    ['PON-1', 'get_topology_path', 'PON_PORT'],
    ['CTO-9', 'get_downstream_clients', 'CTO'],
  ])(
    'direct mode maps %s to %s arguments',
    async (deviceId, toolName, deviceKind) => {
      const topologyProvider = vi.fn(async () => []);
      const result = await runAgent({
        userMessage: `estado de ${deviceId}`,
        connector,
        dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Production' },
        tenantId: 't1',
        mode: 'observe',
        topologyProvider,
      });

      expect(topologyProvider).toHaveBeenCalledOnce();
      expect(result.toolCalls[0]).toMatchObject({
        name: toolName,
        arguments: { deviceKind, deviceId },
      });
    },
  );

  it('direct mode still applies the strict TruthGate after executing the tool', async () => {
    const result = await runAgent({
      userMessage: 'estado de ONU-342',
      connector,
      dataSource: { mode: 'demo', provider: 'SMARTOLT', label: 'Demo' },
      tenantId: 't1',
    });

    expect(getOnuDetail).toHaveBeenCalledOnce();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.verdicts?.[0]?.code).toBe('incomplete');
    expect(result.abstained).toBe(true);
    expect(result.text).toMatch(/^\[DEMO\]/);
    expect(result.route?.mode).toBe('direct');
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

  it('assisted mode allows one tool round and one bounded synthesis call', async () => {
    createMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'get_onu_detail', arguments: { identifier: 'ONU-342' } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce({
        text: 'ONU-342 está online.',
        toolCalls: [],
        usage: { input_tokens: 12, output_tokens: 6 },
      });

    const result = await runAgent({
      userMessage: 'qué pasó ayer con ONU-342?',
      connector,
      dataSource: { mode: 'demo', provider: 'SMARTOLT', label: 'Demo' },
      tenantId: 't1',
      mode: 'observe',
    });

    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(createMessage.mock.calls[1]?.[0].tools).toEqual([]);
    expect(getOnuDetail).toHaveBeenCalledOnce();
    expect(result.text).toBe('ONU-342 está online.');
    expect(result.text).not.toContain('excedió');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.verdicts).toHaveLength(1);
    expect(result.route?.mode).toBe('assisted');
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
