import { describe, expect, it } from 'vitest';
import type { ConfirmedIncident, RelevantIncidentResult } from '@ftth-copilot/shared';
import {
  DEFAULT_LIMIT,
  DEFAULT_SINCE_DAYS,
  MIN_SPARSESCORE,
  MissingTenantError,
  RELEVANT_INCIDENTS_HEADING,
  RRF_K,
  formatRelevantIncidentsBlock,
  retrieveRelevantIncidents,
} from '../src/relevant-incidents';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const DAY_MS = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function incident(overrides: Partial<ConfirmedIncident> & { id: string }): ConfirmedIncident {
  return {
    schema: 'ftth.confirmed-incident.v1',
    tenantId: 't1',
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    sourceTool: 'get_onu_detail',
    summary: 'RX bajo en la ONU',
    symptoms: [],
    rootCause: 'Conector sucio',
    fix: 'Limpieza de conector',
    searchTokens: 'rx bajo onu potencia',
    observedAt: daysAgo(30),
    resolvedAt: daysAgo(30),
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
    confirmedBy: 'operator',
    ...overrides,
  };
}

describe('retrieveRelevantIncidents — constants', () => {
  it('locks the RRF and retrieval defaults', () => {
    expect(RRF_K).toBe(60);
    expect(MIN_SPARSESCORE).toBe(0.05);
    expect(DEFAULT_LIMIT).toBe(5);
    expect(DEFAULT_SINCE_DAYS).toBe(90);
  });
});

describe('retrieveRelevantIncidents — refusal and short-circuits', () => {
  it('throws MissingTenantError when tenantId is empty', () => {
    expect(() =>
      retrieveRelevantIncidents({ tenantId: '', query: 'rx bajo', confirmedIncidents: [] }),
    ).toThrow(MissingTenantError);
  });

  it('returns [] on cold start (no confirmed incidents at all)', () => {
    expect(
      retrieveRelevantIncidents({ tenantId: 't1', query: 'rx bajo', confirmedIncidents: [] }),
    ).toEqual([]);
  });

  it('returns [] in demo mode even when rows would match', () => {
    const rows = [incident({ id: 'ci-1' })];
    expect(
      retrieveRelevantIncidents({
        tenantId: 't1',
        query: 'rx bajo',
        mode: 'demo',
        now: NOW,
        confirmedIncidents: rows,
      }),
    ).toEqual([]);
    // Same rows in live mode DO return — proves the short-circuit is the cause.
    expect(
      retrieveRelevantIncidents({
        tenantId: 't1',
        query: 'rx bajo',
        mode: 'live',
        now: NOW,
        confirmedIncidents: rows,
      }),
    ).toHaveLength(1);
  });
});

describe('retrieveRelevantIncidents — filtering', () => {
  it('drops rows belonging to another tenant (cross-tenant isolation)', () => {
    const results = retrieveRelevantIncidents({
      tenantId: 't2',
      query: 'rx bajo',
      now: NOW,
      confirmedIncidents: [incident({ id: 'ci-1', tenantId: 't1' })],
    });
    expect(results).toEqual([]);
  });

  it('keeps only rows resolved inside the sinceDays window', () => {
    const results = retrieveRelevantIncidents({
      tenantId: 't1',
      query: 'rx bajo',
      now: NOW,
      sinceDays: 90,
      confirmedIncidents: [
        incident({ id: 'old', resolvedAt: daysAgo(100) }),
        incident({ id: 'recent', resolvedAt: daysAgo(30) }),
      ],
    });
    expect(results.map((r) => r.id)).toEqual(['recent']);
  });

  it('drops rows whose sparse score is below MIN_SPARSESCORE', () => {
    const results = retrieveRelevantIncidents({
      tenantId: 't1',
      query: 'rx bajo',
      now: NOW,
      confirmedIncidents: [
        incident({ id: 'match', searchTokens: 'rx bajo onu' }),
        incident({ id: 'unrelated', searchTokens: 'corte fibra troncal' }),
      ],
    });
    expect(results.map((r) => r.id)).toEqual(['match']);
  });

  it('caps the output at the requested limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      incident({ id: `ci-${i}`, searchTokens: `rx bajo onu-${i}` }),
    );
    const results = retrieveRelevantIncidents({
      tenantId: 't1',
      query: 'rx bajo',
      now: NOW,
      limit: 3,
      confirmedIncidents: rows,
    });
    expect(results).toHaveLength(3);
    for (const row of results) {
      expect(row.score).toBeGreaterThanOrEqual(MIN_SPARSESCORE);
    }
  });

  it('caps at DEFAULT_LIMIT when no limit is given', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      incident({ id: `ci-${i}`, searchTokens: `rx bajo onu-${i}` }),
    );
    const results = retrieveRelevantIncidents({
      tenantId: 't1',
      query: 'rx bajo',
      now: NOW,
      confirmedIncidents: rows,
    });
    expect(results).toHaveLength(DEFAULT_LIMIT);
  });
});

describe('retrieveRelevantIncidents — ranking', () => {
  it('ranks the deviceHint-matched row above an otherwise identical row', () => {
    const rows = [
      incident({ id: 'other', deviceId: 'onu-9' }),
      incident({ id: 'hinted', deviceId: 'onu-1' }),
    ];
    const results = retrieveRelevantIncidents({
      tenantId: 't1',
      query: 'rx bajo',
      deviceHint: 'onu-1',
      now: NOW,
      confirmedIncidents: rows,
    });
    expect(results.map((r) => r.id)).toEqual(['hinted', 'other']);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('accepts an object deviceHint and matches on deviceKind + deviceId', () => {
    const results = retrieveRelevantIncidents({
      tenantId: 't1',
      query: 'rx bajo',
      deviceHint: { deviceKind: 'ONU', deviceId: 'onu-1' },
      now: NOW,
      confirmedIncidents: [
        incident({ id: 'other', deviceId: 'onu-9' }),
        incident({ id: 'hinted', deviceId: 'onu-1' }),
      ],
    });
    expect(results.map((r) => r.id)).toEqual(['hinted', 'other']);
  });

  it('returns scores in [0, 1], sorted descending, with rank 1 at RRF top', () => {
    const results = retrieveRelevantIncidents({
      tenantId: 't1',
      query: 'rx bajo potencia',
      now: NOW,
      confirmedIncidents: [
        incident({ id: 'weak', searchTokens: 'rx corte' }),
        incident({ id: 'strong', searchTokens: 'rx bajo potencia onu' }),
      ],
    });
    expect(results.map((r) => r.id)).toEqual(['strong', 'weak']);
    expect(results[0]!.score).toBeCloseTo(1, 6);
    expect(results[1]!.score).toBeCloseTo((RRF_K + 1) / (RRF_K + 2), 6);
    expect(results[1]!.score).toBeLessThan(results[0]!.score);
  });

  it('is deterministic: identical input yields identical output', () => {
    const rows = [
      incident({ id: 'a', searchTokens: 'rx bajo onu' }),
      incident({ id: 'b', searchTokens: 'rx bajo potencia onu' }),
    ];
    const args = { tenantId: 't1', query: 'rx bajo', now: NOW, confirmedIncidents: rows } as const;
    expect(retrieveRelevantIncidents({ ...args })).toEqual(
      retrieveRelevantIncidents({ ...args }),
    );
  });

  it('preserves every ConfirmedIncident field and adds score', () => {
    const [result] = retrieveRelevantIncidents({
      tenantId: 't1',
      query: 'rx bajo',
      now: NOW,
      confirmedIncidents: [incident({ id: 'ci-1' })],
    });
    expect(result!.id).toBe('ci-1');
    expect(result!.rootCause).toBe('Conector sucio');
    expect(typeof result!.score).toBe('number');
  });
});

// ── D-2.3 — Spanish heading + snapshot-locked block formatter ───────────────

describe('RELEVANT_INCIDENTS_HEADING', () => {
  it('is byte-identical to the design-locked literal', () => {
    expect(RELEVANT_INCIDENTS_HEADING).toBe(
      '## Incidentes previos relevantes (contexto, no evidencia)\n\n' +
        '(Estos son contexto de la historia del ISP; no los cites como evidencia de la medición actual.)\n\n',
    );
  });

  it('carries the "contexto, no evidencia" marker and is stable across reads', () => {
    expect(RELEVANT_INCIDENTS_HEADING).toContain('contexto, no evidencia');
    expect(RELEVANT_INCIDENTS_HEADING).toBe(RELEVANT_INCIDENTS_HEADING);
  });
});

describe('formatRelevantIncidentsBlock', () => {
  const rows: RelevantIncidentResult[] = [
    {
      ...incident({
        id: 'ci-1',
        deviceId: 'ONU-1021',
        summary: 'RX bajo sostenido en la ONU',
        rootCause: 'Conector sucio en la caja NAP',
        fix: 'Limpieza y reempalme del conector',
        observedAt: '2026-07-14T09:05:00.000Z',
      }),
      score: 1,
    },
    {
      ...incident({
        id: 'ci-2',
        deviceId: 'OLT-3',
        deviceKind: 'OLT',
        summary: 'Caída de puerto PON',
        rootCause: 'Módulo SFP degradado',
        fix: 'Reemplazo del SFP',
        observedAt: '2026-08-02T23:40:00.000Z',
      }),
      score: 0.983871,
    },
  ];

  it('returns an empty string for an empty list', () => {
    expect(formatRelevantIncidentsBlock([])).toBe('');
  });

  it('renders the heading plus one 1-indexed line per incident (byte-locked)', () => {
    expect(formatRelevantIncidentsBlock(rows)).toBe(
      RELEVANT_INCIDENTS_HEADING +
        '[1] 2026-07-14 — ONU-1021 RX bajo sostenido en la ONU. ' +
        'Causa raíz: Conector sucio en la caja NAP. Fix: Limpieza y reempalme del conector. Score: 1.00\n' +
        '[2] 2026-08-02 — OLT-3 Caída de puerto PON. ' +
        'Causa raíz: Módulo SFP degradado. Fix: Reemplazo del SFP. Score: 0.98\n',
    );
  });

  it('formats observedAt as UTC YYYY-MM-DD regardless of local timezone', () => {
    const block = formatRelevantIncidentsBlock([
      { ...incident({ id: 'ci-3', observedAt: '2026-01-05T23:59:59.000Z' }), score: 0.5 },
    ]);
    expect(block).toContain('[1] 2026-01-05 — ');
  });

  it('preserves Spanish accents and ñ in every interpolated field', () => {
    const block = formatRelevantIncidentsBlock([
      {
        ...incident({
          id: 'ci-4',
          summary: 'Señal débil',
          rootCause: 'Empalme dañado',
          fix: 'Reparación en la caña',
        }),
        score: 0.75,
      },
    ]);
    expect(block).toContain('Señal débil. Causa raíz: Empalme dañado. Fix: Reparación en la caña.');
  });
});

// ── Fase E — tenantPolicy 2nd arg (retrievalLimit / retrievalSinceDays) ──────

describe('retrieveRelevantIncidents — Fase E tenantPolicy 2nd arg', () => {
  const rows = (n: number): ConfirmedIncident[] =>
    Array.from({ length: n }, (_, i) =>
      incident({ id: `ci-${i}`, searchTokens: `rx bajo onu-${i}` }),
    );

  it('tenantPolicy=undefined → byte-identical Fase D behavior (DEFAULT_LIMIT cap)', () => {
    const results = retrieveRelevantIncidents({
      tenantId: 't1',
      query: 'rx bajo',
      now: NOW,
      confirmedIncidents: rows(10),
    });
    expect(results).toHaveLength(DEFAULT_LIMIT);
  });

  it('tenantPolicy={retrievalLimit: 10} → returns up to 10 rows (overrides DEFAULT_LIMIT)', () => {
    const results = retrieveRelevantIncidents(
      { tenantId: 't1', query: 'rx bajo', now: NOW, confirmedIncidents: rows(12) },
      { retrievalLimit: 10 },
    );
    expect(results).toHaveLength(10);
  });

  it('tenantPolicy={retrievalSinceDays: 7} → only 7-day window applies', () => {
    const results = retrieveRelevantIncidents(
      {
        tenantId: 't1',
        query: 'rx bajo',
        now: NOW,
        confirmedIncidents: [
          incident({ id: 'old', searchTokens: 'rx bajo onu', resolvedAt: daysAgo(60) }),
          incident({ id: 'recent', searchTokens: 'rx bajo onu', resolvedAt: daysAgo(3) }),
        ],
      },
      { retrievalSinceDays: 7 },
    );
    expect(results.map((r) => r.id)).toEqual(['recent']);
  });

  it('both knobs together — narrow window + explicit limit', () => {
    const results = retrieveRelevantIncidents(
      {
        tenantId: 't1',
        query: 'rx bajo',
        now: NOW,
        confirmedIncidents: [
          incident({ id: 'old', resolvedAt: daysAgo(60) }),
          incident({ id: 'a', resolvedAt: daysAgo(3) }),
          incident({ id: 'b', resolvedAt: daysAgo(2) }),
          incident({ id: 'c', resolvedAt: daysAgo(1) }),
        ],
      },
      { retrievalLimit: 5, retrievalSinceDays: 14 },
    );
    expect(results.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('args.limit wins over tenantPolicy.retrievalLimit (caller arg has higher precedence)', () => {
    const results = retrieveRelevantIncidents(
      { tenantId: 't1', query: 'rx bajo', now: NOW, limit: 3, confirmedIncidents: rows(12) },
      { retrievalLimit: 10 },
    );
    expect(results).toHaveLength(3);
  });

  it('args.sinceDays wins over tenantPolicy.retrievalSinceDays', () => {
    const results = retrieveRelevantIncidents(
      {
        tenantId: 't1',
        query: 'rx bajo',
        now: NOW,
        sinceDays: 365,
        confirmedIncidents: [
          incident({ id: 'old', resolvedAt: daysAgo(60) }),
          incident({ id: 'recent', resolvedAt: daysAgo(3) }),
        ],
      },
      { retrievalSinceDays: 7 },
    );
    expect(results.map((r) => r.id).sort()).toEqual(['old', 'recent']);
  });
});
