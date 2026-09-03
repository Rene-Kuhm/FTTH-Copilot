import { describe, expect, it, vi } from 'vitest';
import type { INmsConnector } from '@ftth-copilot/connectors-core';
import { evidenceProvenanceSchema, EVIDENCE_PROVENANCE_SCHEMA } from '@ftth-copilot/shared';
import { buildDefaultConnector, buildTools, executeToolCall } from '../src/tools/index';

function connector(): INmsConnector {
  return {
    providerName: 'test',
    ping: vi.fn(async () => ({ ok: true })),
    listOlts: vi.fn(async () => [{ id: 'olt-1', name: 'OLT 1', ip: '1.1.1.1', status: 'online' }] as const),
    getOltDetail: vi.fn(async (id) => ({ id, name: 'OLT 1', ip: '1.1.1.1', status: 'online', onusConnected: 1 })),
    getNetworkOverview: vi.fn(async () => ({ totalOlts: 1, oltsOnline: 1, totalOnus: 1, onusOnline: 1, onusOffline: 0, averageUptimeSeconds: 1, oltsWithHighTemperature: 0 })),
    listOnus: vi.fn(async () => [{ id: 'onu-1', serial: 'sn-1', oltId: 'olt-1', status: 'online' }] as const),
    getOnuDetail: vi.fn(async (id) => id === 'missing' ? null : ({ id, serial: 'sn-1', oltId: 'olt-1', status: 'online' })),
    getOnusWithLowSignal: vi.fn(async () => []),
    searchByCustomerName: vi.fn(async () => []),
  };
}

function parseEnvelope(result: string): { data: unknown; [key: string]: unknown } {
  return JSON.parse(result) as { data: unknown; [key: string]: unknown };
}

describe('agent tools', () => {
  it('exposes only read-only tools', () => {
    const names = buildTools(connector()).map((tool) => tool.name);
    expect(names).toContain('get_network_overview');
    expect(names).not.toContain('reboot_ont');
  });

  it('exposes the predicted-issues tool', () => {
    const names = buildTools(connector()).map((tool) => tool.name);
    expect(names).toContain('get_predicted_issues');
  });

  it('executes get_predicted_issues via the injected provider with curated source', async () => {
    const provider = vi.fn(async () => [{ kind: 'predicted_low_signal', deviceId: 'onu-1' }]);
    const result = await executeToolCall(
      connector(),
      'get_predicted_issues',
      {},
      provider,
      { tenantId: 't1', mode: 'live', provider: 'smartolt' },
    );
    const envelope = parseEnvelope(result);
    expect(envelope.schema).toBe(EVIDENCE_PROVENANCE_SCHEMA);
    expect(envelope.source).toBe('curated');
    expect(envelope.tenantId).toBe('t1');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(evidenceProvenanceSchema.safeParse(envelope).success).toBe(true);
  });

  it('returns a clear error when the predictions provider is absent', async () => {
    const result = await executeToolCall(connector(), 'get_predicted_issues', {});
    expect(result).toContain('no está disponible');
  });

  it('builds the default connector explicitly from environment configuration', () => {
    process.env['SMARTOLT_USE_MOCK'] = 'true';
    expect(buildDefaultConnector().providerName).toBe('smartolt');
    delete process.env['SMARTOLT_USE_MOCK'];
  });

  it.each([
    ['list_olts', {}],
    ['get_olt_detail', { oltId: 'olt-1' }],
    ['get_network_overview', {}],
    ['list_onus', { status: 'online', oltId: 'olt-1' }],
    ['get_onu_detail', { identifier: 'onu-1' }],
    ['get_onus_with_low_signal', { thresholdDbm: -27 }],
    ['search_by_customer_name', { customerName: 'Ada' }],
  ])('executes %s and wraps result in an evidence envelope', async (name, args) => {
    const result = await executeToolCall(
      connector(),
      name,
      args,
      undefined,
      { tenantId: 't1', mode: 'live', provider: 'SMARTOLT' },
    );
    const envelope = parseEnvelope(result);
    const parsed = evidenceProvenanceSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
    expect(envelope.schema).toBe(EVIDENCE_PROVENANCE_SCHEMA);
    expect(envelope.tenantId).toBe('t1');
    if (parsed.success) {
      expect(parsed.data.completeness).toMatch(/^(complete|partial|minimal)$/);
      expect(parsed.data.ttlMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('serializes not-found and unknown-tool results safely (unwrapped)', async () => {
    await expect(executeToolCall(connector(), 'get_onu_detail', { identifier: 'missing' }))
      .resolves.toMatch(/No encontrado/);
    await expect(executeToolCall(connector(), 'unknown', {}))
      .resolves.toMatch(/Tool desconocida/);
  });

  it('returns connector failures as tool errors (unwrapped)', async () => {
    const failing = connector();
    failing.listOlts = vi.fn(async () => { throw new Error('offline'); });
    await expect(executeToolCall(failing, 'list_olts', {})).resolves.toContain('offline');
  });

  it('derives .demo source suffix in demo mode', async () => {
    const result = await executeToolCall(
      connector(),
      'list_olts',
      {},
      undefined,
      { tenantId: 't1', mode: 'demo', provider: 'smartolt' },
    );
    const envelope = parseEnvelope(result);
    expect(envelope.source).toBe('smartolt.demo');
  });

  it('derives .poll source suffix in live mode', async () => {
    const result = await executeToolCall(
      connector(),
      'list_onus',
      {},
      undefined,
      { tenantId: 't1', mode: 'live', provider: 'smartolt' },
    );
    const envelope = parseEnvelope(result);
    expect(envelope.source).toBe('smartolt.poll');
  });

  it('uses the source override when provided', async () => {
    const result = await executeToolCall(
      connector(),
      'list_olts',
      {},
      undefined,
      { tenantId: 't1', mode: 'live', provider: 'smartolt', source: 'custom' },
    );
    const envelope = parseEnvelope(result);
    expect(envelope.source).toBe('custom');
  });

  it('preserves a large raw payload intact under data (R8)', async () => {
    const large = Array.from({ length: 200 }, (_, i) => ({
      id: `onu-${i}`,
      serial: `sn-${i}`,
      signal: -24 + (i % 5),
    }));
    const c = connector();
    c.listOnus = vi.fn(async () => large);
    const result = await executeToolCall(
      c,
      'list_onus',
      {},
      undefined,
      { tenantId: 't1', mode: 'live', provider: 'smartolt' },
    );
    const envelope = parseEnvelope(result);
    const parsed = evidenceProvenanceSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
    expect(envelope.data).toEqual(large);
    if (parsed.success) expect(parsed.data.data).toEqual(large);
  });

  it('derives ttl based on demo vs live mode', async () => {
    const demo = parseEnvelope(await executeToolCall(
      connector(), 'list_olts', {}, undefined,
      { tenantId: 't1', mode: 'demo', provider: 'smartolt' },
    ));
    const live = parseEnvelope(await executeToolCall(
      connector(), 'list_olts', {}, undefined,
      { tenantId: 't1', mode: 'live', provider: 'smartolt' },
    ));
    expect(demo.ttlMs).toBeGreaterThan(live.ttlMs);
  });

  it('returns a structured error instead of an invalid envelope when tenantId is empty', async () => {
    const result = await executeToolCall(connector(), 'list_olts', {});
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed).toHaveProperty('error');
    expect(parsed.error).toContain('Provenance envelope inválido');
  });
});
