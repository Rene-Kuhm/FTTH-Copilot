import { describe, expect, it, vi } from 'vitest';
import type { InvestigationEvidenceRef } from '@ftth-copilot/shared';
import type { InvestigationFacts } from '../src/investigation-facts';
import {
  buildInvestigationSystemPrompt,
  buildInvestigationUserMessage,
  extractJsonFromLlmText,
} from '../src/investigation-prompt';

const buildFacts = (overrides: Partial<InvestigationFacts> = {}): InvestigationFacts => ({
  optical: {
    sampleCount: 2,
    minRxPower: -28.2,
    maxRxPower: -19.5,
    avgRxPower: -23.85,
    deltaRxPower: 8.7,
    hasCriticalAttenuation: true,
    hasWarningAttenuation: true,
  },
  events: {
    totalEvents: 1,
    dyingGaspCount: 1,
    losCount: 0,
    linkDownCount: 1,
    indicatesPowerLoss: true,
    indicatesFiberCut: false,
  },
  topology: {
    hopCount: 1,
    ancestors: ['OLT-1'],
  },
  history: {
    incidentCount: 0,
    hasPriorIncidents: false,
    summaries: [],
  },
  deterministicMissing: [],
  ...overrides,
});

const buildEvidenceRef = (
  overrides: Partial<InvestigationEvidenceRef> = {},
): InvestigationEvidenceRef => ({
  evidenceRefId: 'ref-metric-1',
  kind: 'metric',
  source: 'telemetry:rx_power',
  observedAt: '2026-09-09T10:00:00.000Z',
  summary: 'rx_power: -28.2 dBm',
  quality: 'fresh',
  qualityReason: 'within_ttl',
  ...overrides,
});

describe('extractJsonFromLlmText', () => {
  it('parses a plain JSON object', () => {
    expect(extractJsonFromLlmText('{"sufficiency":"sufficient"}')).toEqual({
      sufficiency: 'sufficient',
    });
  });

  it('parses JSON wrapped in a ```json fence', () => {
    const text = '```json\n{"sufficiency":"provisional","hypotheses":[]}\n```';

    expect(extractJsonFromLlmText(text)).toEqual({
      sufficiency: 'provisional',
      hypotheses: [],
    });
  });

  it('parses JSON wrapped in a fence without a language tag', () => {
    const text = '```\n{"sufficiency":"insufficient"}\n```';

    expect(extractJsonFromLlmText(text)).toEqual({ sufficiency: 'insufficient' });
  });

  it('parses JSON surrounded by prose', () => {
    const text = 'Here is my analysis: {"sufficiency":"sufficient"} — end of report.';

    expect(extractJsonFromLlmText(text)).toEqual({ sufficiency: 'sufficient' });
  });

  it('parses JSON surrounded by prose and a fenced block', () => {
    const text = 'Analysis follows.\n```json\n{"sufficiency":"mixed"}\n```\nDone.';

    expect(extractJsonFromLlmText(text)).toEqual({ sufficiency: 'mixed' });
  });

  it('returns null when the text contains no JSON', () => {
    expect(extractJsonFromLlmText('No JSON here, only prose.')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractJsonFromLlmText('{"sufficiency": "sufficient",}')).toBeNull();
  });

  it('returns null for an unterminated JSON object', () => {
    expect(extractJsonFromLlmText('{"sufficiency": "sufficient"')).toBeNull();
  });

  it('trims surrounding whitespace around plain and fenced JSON', () => {
    expect(extractJsonFromLlmText('\n\n  {"sufficiency":"sufficient"}  \n')).toEqual({
      sufficiency: 'sufficient',
    });
    expect(extractJsonFromLlmText('  ```json\n{"sufficiency":"sufficient"}\n```  ')).toEqual({
      sufficiency: 'sufficient',
    });
  });

  // Documents current behavior: the JSON.parse result is cast to a record, so
  // non-object roots are returned as-is instead of being rejected.
  it('returns a JSON array as-is (no object-shape validation)', () => {
    expect(extractJsonFromLlmText('[1,2]')).toEqual([1, 2]);
  });

  it('returns a JSON string as-is (no object-shape validation)', () => {
    expect(extractJsonFromLlmText('"x"')).toBe('x');
  });

  it('returns null for a literal JSON null, indistinguishable from a parse failure', () => {
    expect(extractJsonFromLlmText('null')).toBeNull();
  });
});

describe('buildInvestigationUserMessage', () => {
  it('embeds the incident, connection and tenant identifiers', () => {
    const message = buildInvestigationUserMessage({
      incidentId: 'inc-101',
      connectionId: 'conn-42',
      tenantId: 'tenant-acme',
    });

    expect(message).toContain('inc-101');
    expect(message).toContain('conn-42');
    expect(message).toContain('tenant-acme');
  });

  it('renders N/A for null incidentId and connectionId', () => {
    const message = buildInvestigationUserMessage({
      incidentId: null,
      connectionId: null,
      tenantId: 'tenant-acme',
    });

    expect(message).toContain('incident N/A');
    expect(message).toContain('connection N/A');
    expect(message).toContain('tenant-acme');
    expect(message).not.toContain('null');
  });
});

describe('buildInvestigationSystemPrompt', () => {
  it('includes every evidence ref field in the available-evidence catalog', () => {
    const evidenceRefs: InvestigationEvidenceRef[] = [
      buildEvidenceRef(),
      buildEvidenceRef({
        evidenceRefId: 'ref-event-1',
        kind: 'event',
        source: 'syslog:olt-1',
        summary: 'event: dying-gasp received from ONU',
        quality: 'stale',
        qualityReason: 'outside_ttl',
      }),
    ];

    const prompt = buildInvestigationSystemPrompt(buildFacts(), evidenceRefs);

    expect(prompt).toContain('ref-metric-1');
    expect(prompt).toContain('telemetry:rx_power');
    expect(prompt).toContain('rx_power: -28.2 dBm');
    expect(prompt).toContain('Kind: metric');
    expect(prompt).toContain('fresh');
    expect(prompt).toContain('ref-event-1');
    expect(prompt).toContain('event: dying-gasp received from ONU');
  });

  it('includes the deterministic facts summary', () => {
    const prompt = buildInvestigationSystemPrompt(buildFacts(), [buildEvidenceRef()]);

    expect(prompt).toContain('samples=2');
    expect(prompt).toContain('minRx=-28.2 dBm');
    expect(prompt).toContain('maxRx=-19.5 dBm');
    expect(prompt).toContain('criticalAttenuation=true');
    expect(prompt).toContain('dyingGasp=1');
    expect(prompt).toContain('ancestors=[OLT-1]');
  });

  it('renders N/A for null optical measurements', () => {
    const facts = buildFacts({
      optical: {
        sampleCount: 0,
        minRxPower: null,
        maxRxPower: null,
        avgRxPower: null,
        deltaRxPower: null,
        hasCriticalAttenuation: false,
        hasWarningAttenuation: false,
      },
    });

    const prompt = buildInvestigationSystemPrompt(facts, []);

    expect(prompt).toContain('minRx=N/A dBm');
    expect(prompt).toContain('maxRx=N/A dBm');
    expect(prompt).toContain('delta=N/A dB');
  });

  it('falls back to a placeholder when there is no evidence', () => {
    const prompt = buildInvestigationSystemPrompt(buildFacts(), []);

    expect(prompt).toContain('(No evidence available)');
  });

  it('is deterministic for the same facts and evidence', () => {
    const facts = buildFacts();
    const evidenceRefs = [buildEvidenceRef()];

    expect(buildInvestigationSystemPrompt(facts, evidenceRefs)).toBe(
      buildInvestigationSystemPrompt(facts, evidenceRefs),
    );
  });

  it('is stable regardless of the current wall-clock time', () => {
    const facts = buildFacts();
    const evidenceRefs = [buildEvidenceRef()];

    vi.setSystemTime(new Date('2026-09-09T12:00:00.000Z'));
    const first = buildInvestigationSystemPrompt(facts, evidenceRefs);
    vi.setSystemTime(new Date('2031-01-01T00:00:00.000Z'));
    const second = buildInvestigationSystemPrompt(facts, evidenceRefs);
    vi.useRealTimers();

    expect(first).toBe(second);
    expect(first).not.toContain('2031');
  });
});
