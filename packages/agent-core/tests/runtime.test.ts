import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INmsConnector } from '@ftth-copilot/connectors-core';
import { evidenceProvenanceSchema, EVIDENCE_PROVENANCE_SCHEMA } from '@ftth-copilot/shared';
import {
  abstentionSchema,
  buildAbstention,
  formatRelevantIncidentsBlock,
  RELEVANT_INCIDENTS_HEADING,
  type Abstention,
  type RelevantIncidentResult,
} from '@ftth-copilot/evidence';

const createMessage = vi.hoisted(() => vi.fn());

// Mock the LLM factory so tests can drive the responses deterministically.
vi.mock('../src/llm', () => ({
  createLlmClient: () => ({ provider: 'mock', createMessage }),
}));

import {
  runAgent,
  formatAbstentionText,
  DEFAULT_TRUTH_GATE_MODE,
  resolveTruthGateMode,
} from '../src/runtime';
import { DEFAULT_TRUTH_GATE_MODE as INDEX_DEFAULT_TRUTH_GATE_MODE } from '../src/index';

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
    // Fase B invariant → pinned to observe mode. The stub connector emits an
    // invalid envelope (no tenantId), so the strict default would abstain and
    // replace this text; that path is covered by the Fase C suite below.
    const result = await runAgent({
      userMessage: 'loop',
      connector,
      maxIterations: 1,
      mode: 'observe',
    });
    expect(result.text).toMatch(/excedió/);
    expect(createMessage).toHaveBeenCalledTimes(1);
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
      // Fase B invariant → pinned to observe mode: the stub connector has no
      // get_network_overview/get_olt_detail, so those two results are
      // incomplete and the strict default would abstain instead of keeping
      // the LLM text. Strict behaviour is asserted in the Fase C suite.
      mode: 'observe',
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
    expect(result.verdicts?.map((v) => v.code)).toEqual(['ok', 'incomplete', 'incomplete']);
    // toolCalls and text unchanged
    expect(result.toolCalls).toHaveLength(3);
    expect(result.text).toBe('final');
    expect(result.abstained).toBeUndefined();
  });

  it('records parse-error/incomplete when executeToolCall returns non-JSON text', async () => {
    // Force executeToolCall to return plain text by stubbing the list_olts
    // connector method to throw — the catch path returns the error JSON
    // envelope, which IS JSON. To exercise the true parse-error branch we
    // stub the connector.listOlts to return a string that is NOT JSON,
    // but the wrapper always stringifies. Instead, we mock the tools
    // module to return plain text and assert the verdict.
    createMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'list_olts', arguments: {} }],
      })
      .mockResolvedValueOnce({ text: 'final', toolCalls: [] });
    // Override executeToolCall to return plain text (not JSON) — this
    // exercises the parse-error path inside classifyToolResult.
    const tools = await import('../src/tools');
    const originalExecute = tools.executeToolCall;
    vi.spyOn(tools, 'executeToolCall').mockImplementation(async () =>
        'this is not JSON at all',
    );
    try {
      const result = await runAgent({
        userMessage: 'plain',
        connector,
        dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
        tenantId: 't1',
      });
      expect(result.verdicts).toHaveLength(1);
      expect(result.verdicts?.[0]).toEqual({
        toolName: 'list_olts',
        code: 'incomplete',
        reason: 'parse-error',
        severity: 'critical',
      });
      // Observe mode invariant: the LLM still gets the raw text.
      const secondCallMessages = createMessage.mock.calls[1]?.[0].messages as Array<{
        role: string;
        content: string;
      }>;
      // The tool-result user message is the last one in the second call.
      const userPayload = secondCallMessages[secondCallMessages.length - 1]?.content ?? '';
      expect(userPayload).toContain('this is not JSON at all');
    } finally {
      vi.mocked(tools.executeToolCall).mockRestore();
      void originalExecute;
    }
  });

  it('preserves a stale envelope verbatim in the next LLM payload (observe mode)', async () => {
    createMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'list_olts', arguments: {} }],
      })
      .mockResolvedValueOnce({ text: 'final', toolCalls: [] });
    const tools = await import('../src/tools');
    const staleRaw = JSON.stringify({
      schema: 'evidence.provenance.v1',
      source: 'smartolt.poll',
      tenantId: 't1',
      observedAt: '2026-08-30T12:00:00.000Z',
      ttlMs: 900000,
      completeness: 'complete',
      confidence: 1.0,
      data: [],
      __stale_marker__: 'PRESERVE_ME_VERBATIM',
    });
    vi.spyOn(tools, 'executeToolCall').mockImplementation(async () => staleRaw);
    try {
      const result = await runAgent({
        userMessage: 'stale',
        connector,
        dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
        tenantId: 't1',
      });
      // Stale verdict recorded
      expect(result.verdicts?.[0]?.code).toBe('stale');
      // Original raw string still in the LLM payload, byte-identical
      const secondCallMessages = createMessage.mock.calls[1]?.[0].messages as Array<{
        role: string;
        content: string;
      }>;
      // The tool-result user message is the last one in the second call.
      const userPayload = secondCallMessages[secondCallMessages.length - 1]?.content ?? '';
      expect(userPayload).toContain('__stale_marker__');
      expect(userPayload).toContain('PRESERVE_ME_VERBATIM');
    } finally {
      vi.mocked(tools.executeToolCall).mockRestore();
    }
  });
});

// ── Fase C — TruthGate mode plumbing (task 2.1) ──────────────────────────────

describe('TruthGate mode resolution', () => {
  it('defaults to strict', () => {
    expect(DEFAULT_TRUTH_GATE_MODE).toBe('strict');
  });

  it('is re-exported from the package entrypoint with the same value', () => {
    expect(INDEX_DEFAULT_TRUTH_GATE_MODE).toBe('strict');
    expect(INDEX_DEFAULT_TRUTH_GATE_MODE).toBe(DEFAULT_TRUTH_GATE_MODE);
  });

  it('resolves an omitted mode to the strict default', () => {
    expect(resolveTruthGateMode(undefined)).toBe('strict');
  });

  it('preserves an explicit observe mode', () => {
    expect(resolveTruthGateMode('observe')).toBe('observe');
  });

  it('preserves an explicit strict mode', () => {
    expect(resolveTruthGateMode('strict')).toBe('strict');
  });

  it('accepts mode on RunAgentOptions without altering the Fase B result shape', async () => {
    createMessage.mockResolvedValueOnce({ text: 'respuesta observe', toolCalls: [] });
    const result = await runAgent({ userMessage: 'hola', connector, mode: 'observe' });
    expect(result.text).toBe('respuesta observe');
    expect(result.toolCalls).toEqual([]);
    expect(result.verdicts).toEqual([]);
  });
});

// ── Fase C — abstention rendering + strict-mode override (tasks 2.2 / 2.3) ────

/**
 * Builds a fresh, complete `evidence.provenance.v1` envelope. Overrides let a
 * test flip exactly one dimension (staleness, confidence, completeness) so the
 * resulting verdict is unambiguous.
 */
const envelope = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schema: EVIDENCE_PROVENANCE_SCHEMA,
    source: 'smartolt.poll',
    tenantId: 't1',
    observedAt: new Date().toISOString(),
    ttlMs: 900_000,
    completeness: 'complete',
    confidence: 1,
    data: [],
    ...overrides,
  });

/** Runs `body` with `executeToolCall` stubbed per tool name, then restores it. */
async function withToolResults<T>(
  resultFor: (toolName: string) => string,
  body: () => Promise<T>,
): Promise<T> {
  const tools = await import('../src/tools');
  vi.spyOn(tools, 'executeToolCall').mockImplementation(async (_connector, toolName) =>
    resultFor(toolName),
  );
  try {
    return await body();
  } finally {
    vi.mocked(tools.executeToolCall).mockRestore();
  }
}

const incompleteFor = (toolName: string): Abstention =>
  buildAbstention([
    { toolName, code: 'incomplete', reason: 'no-envelope', severity: 'critical' },
  ]);

describe('formatAbstentionText', () => {
  it('renders heading + missing bullets + nextStep for an identifier failure', () => {
    expect(formatAbstentionText(incompleteFor('get_onu_detail'))).toBe(
      'No puedo responder con la evidencia disponible.\n\n' +
        'Falta evidencia de:\n' +
        '- get_onu_detail\n\n' +
        'No pude respaldar el diagnóstico: el identificador get_onu_detail no figura en el NMS. ' +
        'Verificá el identificador (ID, SN o filtro) y volvé a intentar.',
    );
  });

  it('renders the metrics nextStep variant for a metrics failure', () => {
    expect(formatAbstentionText(incompleteFor('get_metrics'))).toBe(
      'No puedo responder con la evidencia disponible.\n\n' +
        'Falta evidencia de:\n' +
        '- get_metrics\n\n' +
        'No pude respaldar el diagnóstico: las métricas get_metrics están vencidas o incompletas. ' +
        'Re-colectá datos frescos de los últimos 15 minutos antes de diagnosticar.',
    );
  });

  it('renders one bullet per missing tool', () => {
    const abstention = buildAbstention([
      { toolName: 'get_onu_detail', code: 'incomplete', reason: 'no-envelope', severity: 'critical' },
      { toolName: 'get_olt_detail', code: 'incomplete', reason: 'parse-error', severity: 'critical' },
    ]);
    const text = formatAbstentionText(abstention);
    expect(text).toContain('Falta evidencia de:\n- get_onu_detail\n- get_olt_detail');
    expect(text.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(2);
  });

  it('omits the bullet block when nothing is listed as missing', () => {
    const abstention: Abstention = { ...incompleteFor('get_onu_detail'), missing: [] };
    expect(formatAbstentionText(abstention)).toBe(
      'No puedo responder con la evidencia disponible.\n\n' + abstention.nextStep,
    );
    expect(formatAbstentionText(abstention)).not.toContain('Falta evidencia de:');
  });

  it('is byte-identical across invocations and keeps the voseo register', () => {
    const abstention = incompleteFor('get_onu_detail');
    expect(formatAbstentionText(abstention)).toBe(formatAbstentionText(abstention));
    expect(formatAbstentionText(abstention)).toMatch(/Verificá|volvé/);
    expect(formatAbstentionText(abstention)).toContain('get_onu_detail');
  });
});

describe('runAgent strict-mode abstention override', () => {
  const EXPECTED_ONU_TEXT =
    'No puedo responder con la evidencia disponible.\n\n' +
    'Falta evidencia de:\n' +
    '- get_onu_detail\n\n' +
    'No pude respaldar el diagnóstico: el identificador get_onu_detail no figura en el NMS. ' +
    'Verificá el identificador (ID, SN o filtro) y volvé a intentar.';

  it('strict + incomplete replaces the LLM text at the no-tool-call return path', async () => {
    createMessage
      .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'get_onu_detail', arguments: {} }] })
      .mockResolvedValueOnce({ text: 'La ONU está perfecta.', toolCalls: [] });

    const result = await withToolResults(
      () => 'esto no es JSON',
      () => runAgent({ userMessage: 'diagnosticá', connector }),
    );

    expect(result.abstained).toBe(true);
    expect(result.text).toBe(EXPECTED_ONU_TEXT);
    expect(result.text).not.toContain('La ONU está perfecta.');
    expect(abstentionSchema.safeParse(result.abstention).success).toBe(true);
    expect(result.abstention?.missing).toEqual(['get_onu_detail']);
    expect(result.abstention?.available).toEqual([]);
    expect(result.verdicts).toHaveLength(1);
    expect(result.verdicts?.[0]?.code).toBe('incomplete');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('get_onu_detail');
  });

  it('strict + incomplete replaces the LLM text at the end-of-loop return path', async () => {
    createMessage.mockResolvedValue({
      text: '',
      toolCalls: [{ name: 'get_onu_detail', arguments: {} }],
    });

    const result = await withToolResults(
      () => 'esto no es JSON',
      () => runAgent({ userMessage: 'loop', connector, maxIterations: 1 }),
    );

    expect(result.abstained).toBe(true);
    expect(result.text).toBe(EXPECTED_ONU_TEXT);
    expect(result.text).not.toMatch(/excedió/);
    expect(result.abstention?.missing).toEqual(['get_onu_detail']);
    expect(result.verdicts).toHaveLength(1);
  });

  it('strict + mixed incomplete/ok abstains and reports what was available', async () => {
    createMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { name: 'list_onus', arguments: {} },
          { name: 'get_onu_detail', arguments: {} },
        ],
      })
      .mockResolvedValueOnce({ text: 'Diagnóstico inventado.', toolCalls: [] });

    const result = await withToolResults(
      (toolName) => (toolName === 'list_onus' ? envelope() : 'esto no es JSON'),
      () => runAgent({ userMessage: 'mixto', connector }),
    );

    expect(result.abstained).toBe(true);
    expect(result.abstention?.missing).toEqual(['get_onu_detail']);
    expect(result.abstention?.available).toEqual(['list_onus']);
    expect(result.text).toContain('- get_onu_detail');
    expect(result.text).not.toContain('Diagnóstico inventado.');
    expect(result.verdicts?.map((v) => v.code)).toEqual(['ok', 'incomplete']);
  });

  it('strict + stale only keeps the LLM text (Fase B warning behaviour)', async () => {
    createMessage
      .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'list_onus', arguments: {} }] })
      .mockResolvedValueOnce({ text: 'Hay 12 ONUs online.', toolCalls: [] });

    const result = await withToolResults(
      () => envelope({ observedAt: '2026-08-30T12:00:00.000Z' }),
      () => runAgent({ userMessage: 'stale', connector }),
    );

    expect(result.verdicts?.[0]?.code).toBe('stale');
    expect(result.text).toBe('Hay 12 ONUs online.');
    expect(result.abstained).toBeUndefined();
    expect(result.abstention).toBeUndefined();
  });

  it('strict + low_confidence only keeps the LLM text', async () => {
    createMessage
      .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'list_onus', arguments: {} }] })
      .mockResolvedValueOnce({ text: 'Hay 12 ONUs online.', toolCalls: [] });

    const result = await withToolResults(
      () => envelope({ confidence: 0.1 }),
      () => runAgent({ userMessage: 'low conf', connector }),
    );

    expect(result.verdicts?.[0]?.code).toBe('low_confidence');
    expect(result.text).toBe('Hay 12 ONUs online.');
    expect(result.abstained).toBeUndefined();
    expect(result.abstention).toBeUndefined();
  });

  it('strict + only ok verdicts keeps the LLM text', async () => {
    createMessage
      .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'list_onus', arguments: {} }] })
      .mockResolvedValueOnce({ text: 'Hay 12 ONUs online.', toolCalls: [] });

    const result = await withToolResults(
      () => envelope(),
      () => runAgent({ userMessage: 'ok', connector }),
    );

    expect(result.verdicts?.[0]?.code).toBe('ok');
    expect(result.text).toBe('Hay 12 ONUs online.');
    expect(result.abstained).toBeUndefined();
    expect(result.abstention).toBeUndefined();
  });

  it('strict + no tool calls (no verdicts) keeps the LLM text', async () => {
    createMessage.mockResolvedValueOnce({ text: 'Respuesta directa.', toolCalls: [] });

    const result = await runAgent({ userMessage: 'hola', connector });

    expect(result.verdicts).toEqual([]);
    expect(result.text).toBe('Respuesta directa.');
    expect(result.abstained).toBeUndefined();
    expect(result.abstention).toBeUndefined();
  });

  it('observe + incomplete keeps the LLM text at the no-tool-call return path', async () => {
    createMessage
      .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'get_onu_detail', arguments: {} }] })
      .mockResolvedValueOnce({ text: 'La ONU está perfecta.', toolCalls: [] });

    const result = await withToolResults(
      () => 'esto no es JSON',
      () => runAgent({ userMessage: 'observe', connector, mode: 'observe' }),
    );

    expect(result.verdicts?.[0]?.code).toBe('incomplete');
    expect(result.text).toBe('La ONU está perfecta.');
    expect(result.abstained).toBeUndefined();
    expect(result.abstention).toBeUndefined();
  });

  it('observe + incomplete keeps the loop-limit text at the end-of-loop return path', async () => {
    createMessage.mockResolvedValue({
      text: '',
      toolCalls: [{ name: 'get_onu_detail', arguments: {} }],
    });

    const result = await withToolResults(
      () => 'esto no es JSON',
      () => runAgent({ userMessage: 'loop', connector, mode: 'observe', maxIterations: 1 }),
    );

    expect(result.verdicts?.[0]?.code).toBe('incomplete');
    expect(result.text).toMatch(/excedió/);
    expect(result.abstained).toBeUndefined();
    expect(result.abstention).toBeUndefined();
  });

  it('observe + stale/low_confidence keeps the LLM text', async () => {
    createMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { name: 'list_onus', arguments: {} },
          { name: 'list_olts', arguments: {} },
        ],
      })
      .mockResolvedValueOnce({ text: 'Reporte completo.', toolCalls: [] });

    const result = await withToolResults(
      (toolName) =>
        toolName === 'list_onus'
          ? envelope({ observedAt: '2026-08-30T12:00:00.000Z' })
          : envelope({ confidence: 0.1 }),
      () => runAgent({ userMessage: 'warnings', connector, mode: 'observe' }),
    );

    expect(result.verdicts?.map((v) => v.code)).toEqual(['stale', 'low_confidence']);
    expect(result.text).toBe('Reporte completo.');
    expect(result.abstained).toBeUndefined();
  });

  it('demo and live sources abstain identically for the same incomplete evidence', async () => {
    const runWith = async (source: string, mode: 'demo' | 'live') => {
      createMessage
        .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'get_onu_detail', arguments: {} }] })
        .mockResolvedValueOnce({ text: 'Texto del LLM.', toolCalls: [] });
      return withToolResults(
        () => envelope({ source, completeness: 'minimal' }),
        () =>
          runAgent({
            userMessage: 'paridad',
            connector,
            dataSource: { mode, provider: 'SMARTOLT', label: 'X' },
          }),
      );
    };

    const demo = await runWith('smartolt.demo', 'demo');
    createMessage.mockReset();
    const live = await runWith('smartolt.poll', 'live');

    expect(demo.abstained).toBe(true);
    expect(live.abstained).toBe(true);
    expect(demo.text).toBe(live.text);
    expect(demo.abstention).toEqual(live.abstention);
    expect(demo.verdicts?.[0]?.reason).toBe('minimal-completeness');
    expect(live.verdicts?.[0]?.reason).toBe('minimal-completeness');
  });
});

// ── Fase D — retrievalProvider injection (task 3.1) ──────────────────────────
//
// Contract: `RunAgentOptions.retrievalProvider` is opt-in. When provided AND
// `dataSource.mode === 'live'`, runAgent calls it once before the loop and
// appends `RELEVANT_INCIDENTS_HEADING + formatRelevantIncidentsBlock(results)`
// to the LLM system prompt. In every other case (provider undefined, returns
// empty, mode is demo, or provider throws) the system prompt is byte-identical
// to the pre-Fase-D baseline. Retrieved rows never enter the Truth Gate data
// path: `result.verdicts` and `result.toolCalls` count only tool calls.

const incident = (
  overrides: Partial<RelevantIncidentResult> & { id: string },
): RelevantIncidentResult => ({
  schema: 'ftth.confirmed-incident.v1',
  id: overrides.id,
  tenantId: 't1',
  deviceKind: 'ONU',
  deviceId: 'onu-1',
  sourceTool: 'get_onu_detail',
  summary: 'RX bajo en la ONU',
  symptoms: [],
  rootCause: 'Conector sucio',
  fix: 'Limpieza de conector',
  observedAt: '2026-08-30T12:00:00.000Z',
  resolvedAt: '2026-08-30T13:00:00.000Z',
  createdAt: '2026-08-30T12:00:00.000Z',
  updatedAt: '2026-08-30T13:00:00.000Z',
  confirmedBy: 'operator',
  searchTokens: ['rx', 'bajo', 'onu'],
  score: 1,
  ...overrides,
});

describe('runAgent — retrievalProvider injection (Fase D / WU3)', () => {
  it('does NOT inject the heading when retrievalProvider is undefined', async () => {
    createMessage.mockResolvedValueOnce({ text: 'sin retrieval', toolCalls: [] });
    const result = await runAgent({
      userMessage: 'hola',
      connector,
      dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
      tenantId: 't1',
    });
    expect(result.text).toBe('sin retrieval');
    const system = createMessage.mock.calls[0]?.[0].system as string;
    expect(system).not.toContain(RELEVANT_INCIDENTS_HEADING);
  });

  it('does NOT inject the heading when retrievalProvider returns []', async () => {
    createMessage.mockResolvedValueOnce({ text: 'vacio', toolCalls: [] });
    const retrievalProvider = vi.fn(async () => []);
    await runAgent({
      userMessage: 'hola',
      connector,
      dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
      tenantId: 't1',
      retrievalProvider,
    });
    expect(retrievalProvider).toHaveBeenCalledTimes(1);
    const system = createMessage.mock.calls[0]?.[0].system as string;
    expect(system).not.toContain(RELEVANT_INCIDENTS_HEADING);
  });

  it('injects RELEVANT_INCIDENTS_HEADING + 2 per-incident lines when provider returns 2 rows (live)', async () => {
    createMessage.mockResolvedValueOnce({ text: 'con contexto', toolCalls: [] });
    const results: RelevantIncidentResult[] = [
      incident({ id: 'ci-1', deviceId: 'onu-1', score: 1 }),
      incident({ id: 'ci-2', deviceId: 'onu-2', score: 0.5 }),
    ];
    await runAgent({
      userMessage: 'hola',
      connector,
      dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
      tenantId: 't1',
      retrievalProvider: async () => results,
    });
    const system = createMessage.mock.calls[0]?.[0].system as string;
    expect(system).toContain(RELEVANT_INCIDENTS_HEADING);
    expect(system.split('\n').filter((line) => /^\[\d+\] /.test(line))).toHaveLength(2);
    expect(system).toContain('onu-1');
    expect(system).toContain('onu-2');
  });

  it('byte-identical snapshot: augmented system-prompt block with 2 incidents', async () => {
    createMessage.mockResolvedValueOnce({ text: 'snapshot', toolCalls: [] });
    const results: RelevantIncidentResult[] = [
      incident({ id: 'ci-1', deviceId: 'onu-1', score: 1 }),
      incident({ id: 'ci-2', deviceId: 'onu-2', score: 0.5 }),
    ];
    await runAgent({
      userMessage: 'hola',
      connector,
      dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
      tenantId: 't1',
      retrievalProvider: async () => results,
    });
    const system = createMessage.mock.calls[0]?.[0].system as string;
    const expectedBlock = formatRelevantIncidentsBlock(results);
    // The retrieval block must be present verbatim and placed at the tail of
    // the system prompt (after the data-source block).
    expect(system.endsWith(expectedBlock)).toBe(true);
    expect(system).toContain(expectedBlock);
  });

  it('skips retrieval when mode is demo even if retrievalProvider is defined', async () => {
    createMessage.mockResolvedValueOnce({ text: '[DEMO] respuesta', toolCalls: [] });
    const retrievalProvider = vi.fn(async () => [incident({ id: 'ci-1' })]);
    const result = await runAgent({
      userMessage: 'hola',
      connector,
      dataSource: { mode: 'demo', provider: 'SMARTOLT', label: 'Demo' },
      tenantId: 't1',
      retrievalProvider,
    });
    expect(result.text).toContain('[DEMO]');
    expect(retrievalProvider).not.toHaveBeenCalled();
    const system = createMessage.mock.calls[0]?.[0].system as string;
    expect(system).not.toContain(RELEVANT_INCIDENTS_HEADING);
    expect(system).toContain('DATOS SIMULADOS');
  });

  it('fails open: retrievalProvider throws and the agent continues without augmentation', async () => {
    createMessage.mockResolvedValueOnce({ text: 'sin contexto', toolCalls: [] });
    const retrievalProvider = vi.fn(async () => {
      throw new Error('retrieval down');
    });
    await expect(
      runAgent({
        userMessage: 'hola',
        connector,
        dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
        tenantId: 't1',
        retrievalProvider,
      }),
    ).resolves.toMatchObject({ text: 'sin contexto' });
    const system = createMessage.mock.calls[0]?.[0].system as string;
    expect(system).not.toContain(RELEVANT_INCIDENTS_HEADING);
    expect(retrievalProvider).toHaveBeenCalledTimes(1);
  });

  it('Truth-Gate invariant: 2 retrieved + 2 tool calls → verdicts.length===2 AND toolCalls has no retrieved rows', async () => {
    createMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { name: 'list_olts', arguments: {} },
          { name: 'list_onus', arguments: {} },
        ],
      })
      .mockResolvedValueOnce({ text: 'final', toolCalls: [] });
    const results: RelevantIncidentResult[] = [
      incident({ id: 'ci-1' }),
      incident({ id: 'ci-2', deviceId: 'onu-2' }),
    ];
    const result = await runAgent({
      userMessage: 'multi',
      connector,
      dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
      tenantId: 't1',
      // observe mode so the stale/incomplete verdict from the stub connector
      // does not abstain — keeps the test focused on Truth-Gate data path.
      mode: 'observe',
      retrievalProvider: async () => results,
    });
    expect(result.verdicts).toHaveLength(2);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls?.map((tc) => tc.name)).toEqual(['list_olts', 'list_onus']);
    // The retrieved rows MUST NOT leak into the LLM payload as a tool result.
    const secondCallMessages = createMessage.mock.calls[1]?.[0].messages as Array<{
      role: string;
      content: string;
    }>;
    const userPayload = secondCallMessages[secondCallMessages.length - 1]?.content ?? '';
    expect(userPayload).not.toContain('ci-1');
    expect(userPayload).not.toContain('ci-2');
  });

  it('extracts a deviceHint from the user message and forwards it to the provider (live)', async () => {
    createMessage.mockResolvedValueOnce({ text: 'listo', toolCalls: [] });
    const retrievalProvider = vi.fn(async () => []);
    await runAgent({
      userMessage: 'Hay un problema con ONU-123 que perdió RX',
      connector,
      dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'Producción' },
      tenantId: 't1',
      retrievalProvider,
    });
    expect(retrievalProvider).toHaveBeenCalledTimes(1);
    const args = retrievalProvider.mock.calls[0]?.[0] as { deviceHint?: string };
    expect(args.deviceHint).toBe('ONU-123');
  });
});
