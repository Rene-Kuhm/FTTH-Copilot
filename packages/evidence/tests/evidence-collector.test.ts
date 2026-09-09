import { describe, expect, it } from 'vitest';
import {
  investigationEvidenceRefSchema,
  MAX_INVESTIGATION_EVIDENCE_REFS,
  MAX_INVESTIGATION_WINDOW_DAYS,
  INVESTIGATION_FREE_TEXT_BYTES,
} from '@ftth-copilot/shared';
import {
  collectInvestigationEvidence,
  type CollectEvidenceArgs,
  type MetricEvidenceInput,
  type EventEvidenceInput,
  type TopologyEvidenceInput,
  type IncidentHistoryEvidenceInput,
  type FeedbackEvidenceInput,
  MissingTenantError,
} from '../src/evidence-collector';

const TENANT = 'tenant-fibra-1';
const OTHER_TENANT = 'tenant-neighbor-9';
const DEVICE_ID = 'onu-olt1-pon2-14';
const START = '2026-08-01T00:00:00.000Z';
const END = '2026-08-08T00:00:00.000Z';
const MID = '2026-08-04T12:00:00.000Z';

function baseArgs(overrides: Partial<CollectEvidenceArgs> = {}): CollectEvidenceArgs {
  return {
    tenantId: TENANT,
    deviceId: DEVICE_ID,
    connectionId: 'conn-smartolt-1',
    incidentId: 'inc-2026-402',
    windowStart: START,
    windowEnd: END,
    cutoffAt: END,
    metrics: [
      {
        sampleId: 'm-1',
        tenantId: TENANT,
        deviceId: DEVICE_ID,
        metricKind: 'RX_POWER_DBM',
        value: -27.4,
        unit: 'dBm',
        recordedAt: MID,
        source: 'smartolt.poll',
      },
    ],
    events: [
      {
        eventId: 'e-1',
        tenantId: TENANT,
        deviceId: DEVICE_ID,
        category: 'access',
        message: 'ONU optical LOS cleared',
        observedAt: MID,
        source: 'syslog',
      },
    ],
    topologyHops: [
      {
        tenantId: TENANT,
        sourceKind: 'OLT',
        sourceId: 'olt-sj-1',
        targetKind: 'ONU',
        targetId: DEVICE_ID,
        depth: 1,
        observedAt: MID,
      },
    ],
    confirmedIncidents: [
      {
        incidentId: 'inc-old-99',
        tenantId: TENANT,
        deviceId: DEVICE_ID,
        summary: 'Atenuación severa por conector sucio en ODF',
        rootCause: 'dirty_connector',
        fix: 'Limpieza con cassette limpiador y alcohol isopropílico',
        resolvedAt: '2026-08-02T10:00:00.000Z',
      },
    ],
    feedbacks: [
      {
        feedbackId: 'fb-1',
        tenantId: TENANT,
        runId: 'r_prev_1',
        versionId: 'v_prev_1',
        label: 'confirmed',
        observations: 'Confirmado por técnico en campo',
        realCause: 'dirty_connector',
        submittedAt: '2026-08-03T14:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('collectInvestigationEvidence — happy path', () => {
  it('collects all 5 evidence kinds and produces schema-valid references', () => {
    const args = baseArgs();
    const refs = collectInvestigationEvidence(args);

    expect(refs.length).toBe(5);

    // Every item MUST strictly parse against the contract locked in PR #120
    for (const ref of refs) {
      expect(() => investigationEvidenceRefSchema.parse(ref)).not.toThrow();
    }

    const kinds = refs.map((r) => r.kind);
    expect(kinds).toContain('metric');
    expect(kinds).toContain('event');
    expect(kinds).toContain('topology');
    expect(kinds).toContain('incident_history');
    expect(kinds).toContain('feedback');
  });
});

describe('collectInvestigationEvidence — multi-tenant isolation', () => {
  it('strictly discards records belonging to a different tenant', () => {
    const args = baseArgs({
      metrics: [
        {
          sampleId: 'm-valid',
          tenantId: TENANT,
          deviceId: DEVICE_ID,
          metricKind: 'RX_POWER_DBM',
          value: -22.1,
          recordedAt: MID,
        },
        {
          sampleId: 'm-alien',
          tenantId: OTHER_TENANT,
          deviceId: DEVICE_ID,
          metricKind: 'RX_POWER_DBM',
          value: -40.0,
          recordedAt: MID,
        },
      ],
      events: [
        {
          eventId: 'e-alien',
          tenantId: OTHER_TENANT,
          deviceId: DEVICE_ID,
          category: 'auth_failure',
          message: 'Intrusion alert on neighbor tenant',
          observedAt: MID,
        },
      ],
      topologyHops: [],
      confirmedIncidents: [],
      feedbacks: [],
    });

    const refs = collectInvestigationEvidence(args);
    expect(refs.length).toBe(1);
    expect(refs[0].evidenceRefId).toContain('m-valid');
    expect(refs.some((r) => r.summary.includes('neighbor'))).toBe(false);
  });

  it('throws MissingTenantError when tenantId is empty or whitespace', () => {
    expect(() => collectInvestigationEvidence(baseArgs({ tenantId: '' }))).toThrow(
      MissingTenantError,
    );
    expect(() => collectInvestigationEvidence(baseArgs({ tenantId: '   ' }))).toThrow(
      MissingTenantError,
    );
  });
});

describe('collectInvestigationEvidence — window invariants & filtering', () => {
  it('filters out metrics and events outside [windowStart, windowEnd]', () => {
    const beforeStart = '2026-07-31T23:59:59.000Z';
    const afterEnd = '2026-08-08T00:00:01.000Z';

    const args = baseArgs({
      metrics: [
        {
          sampleId: 'm-before',
          tenantId: TENANT,
          deviceId: DEVICE_ID,
          metricKind: 'RX_POWER_DBM',
          value: -19.0,
          recordedAt: beforeStart,
        },
        {
          sampleId: 'm-in',
          tenantId: TENANT,
          deviceId: DEVICE_ID,
          metricKind: 'RX_POWER_DBM',
          value: -23.0,
          recordedAt: MID,
        },
        {
          sampleId: 'm-after',
          tenantId: TENANT,
          deviceId: DEVICE_ID,
          metricKind: 'RX_POWER_DBM',
          value: -30.0,
          recordedAt: afterEnd,
        },
      ],
      events: [],
      topologyHops: [],
      confirmedIncidents: [],
      feedbacks: [],
    });

    const refs = collectInvestigationEvidence(args);
    expect(refs.length).toBe(1);
    expect(refs[0].evidenceRefId).toContain('m-in');
  });

  it('throws when windowEnd < windowStart', () => {
    const invalidWindow = baseArgs({
      windowStart: '2026-08-10T00:00:00.000Z',
      windowEnd: '2026-08-01T00:00:00.000Z',
    });
    expect(() => collectInvestigationEvidence(invalidWindow)).toThrow(/windowEnd/);
  });

  it('throws when windowDays > MAX_INVESTIGATION_WINDOW_DAYS (30 days)', () => {
    const tooWide = baseArgs({
      windowStart: '2026-07-01T00:00:00.000Z',
      windowEnd: '2026-08-10T00:00:00.000Z', // 40 days
    });
    expect(() => collectInvestigationEvidence(tooWide)).toThrow(/MAX_INVESTIGATION_WINDOW_DAYS/);
  });
});

describe('collectInvestigationEvidence — historical context demarcation', () => {
  it('marks confirmed incidents with [Contexto Histórico] and treats them as context', () => {
    const args = baseArgs({
      metrics: [],
      events: [],
      topologyHops: [],
      feedbacks: [],
      confirmedIncidents: [
        {
          incidentId: 'inc-hist-1',
          tenantId: TENANT,
          deviceId: DEVICE_ID,
          summary: 'Corte de fibra troncal',
          rootCause: 'fiber_cut',
          resolvedAt: '2026-08-02T12:00:00.000Z',
        },
      ],
    });

    const refs = collectInvestigationEvidence(args);
    expect(refs.length).toBe(1);
    expect(refs[0].kind).toBe('incident_history');
    expect(refs[0].summary).toMatch(/^\[Contexto Histórico\]/);
    expect(refs[0].summary).toContain('Corte de fibra troncal');
  });
});

describe('collectInvestigationEvidence — metric quality assessment', () => {
  it('assigns fresh quality when samples are close to cutoff', () => {
    const args = baseArgs({
      events: [],
      topologyHops: [],
      confirmedIncidents: [],
      feedbacks: [],
      metrics: [
        {
          sampleId: 'm-fresh',
          tenantId: TENANT,
          deviceId: DEVICE_ID,
          metricKind: 'RX_POWER_DBM',
          value: -21.5,
          recordedAt: END, // exactly at cutoff
        },
      ],
    });

    const refs = collectInvestigationEvidence(args);
    expect(refs[0].quality).toBe('fresh');
  });

  it('assigns stale quality when sample is old relative to cutoff', () => {
    const args = baseArgs({
      events: [],
      topologyHops: [],
      confirmedIncidents: [],
      feedbacks: [],
      metrics: [
        {
          sampleId: 'm-old',
          tenantId: TENANT,
          deviceId: DEVICE_ID,
          metricKind: 'RX_POWER_DBM',
          value: -21.5,
          recordedAt: START, // 7 days prior to cutoff
        },
      ],
    });

    const refs = collectInvestigationEvidence(args);
    expect(refs[0].quality).toBe('stale');
  });
});

describe('collectInvestigationEvidence — bounding & cap discipline', () => {
  it('never exceeds MAX_INVESTIGATION_EVIDENCE_REFS (64) even with 200 input samples', () => {
    const manyMetrics: MetricEvidenceInput[] = Array.from({ length: 150 }, (_, i) => ({
      sampleId: `m-bulk-${i}`,
      tenantId: TENANT,
      deviceId: DEVICE_ID,
      metricKind: 'RX_POWER_DBM',
      value: -20 - (i % 10),
      recordedAt: new Date(new Date(START).getTime() + i * 3600_000).toISOString(),
    }));

    const args = baseArgs({
      metrics: manyMetrics,
      events: [],
      topologyHops: [],
      confirmedIncidents: [],
      feedbacks: [],
    });

    const refs = collectInvestigationEvidence(args);
    expect(refs.length).toBeLessThanOrEqual(MAX_INVESTIGATION_EVIDENCE_REFS);
    expect(refs.length).toBe(MAX_INVESTIGATION_EVIDENCE_REFS);
  });
});

describe('collectInvestigationEvidence — deterministic ordering', () => {
  it('sorts references by observedAt descending, then kind, then refId', () => {
    const t1 = '2026-08-02T10:00:00.000Z';
    const t2 = '2026-08-05T10:00:00.000Z';
    const t3 = '2026-08-07T10:00:00.000Z';

    const args = baseArgs({
      metrics: [
        {
          sampleId: 'm-t1',
          tenantId: TENANT,
          deviceId: DEVICE_ID,
          metricKind: 'RX_POWER_DBM',
          value: -20,
          recordedAt: t1,
        },
        {
          sampleId: 'm-t3',
          tenantId: TENANT,
          deviceId: DEVICE_ID,
          metricKind: 'RX_POWER_DBM',
          value: -21,
          recordedAt: t3,
        },
      ],
      events: [
        {
          eventId: 'e-t2',
          tenantId: TENANT,
          deviceId: DEVICE_ID,
          category: 'access',
          message: 'event at t2',
          observedAt: t2,
        },
      ],
      topologyHops: [],
      confirmedIncidents: [],
      feedbacks: [],
    });

    const refs = collectInvestigationEvidence(args);
    expect(refs.map((r) => r.observedAt)).toEqual([t3, t2, t1]);
  });
});
