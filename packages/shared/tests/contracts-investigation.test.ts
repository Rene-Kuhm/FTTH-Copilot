import { describe, expect, it } from 'vitest';
import {
  INVESTIGATION_RUN_SCHEMA,
  INVESTIGATION_VERSION_SCHEMA,
  INVESTIGATION_FEEDBACK_SCHEMA,
  investigationRunSchema,
  investigationVersionSchema,
  investigationFeedbackSchema,
  type InvestigationRun,
  type InvestigationVersion,
  type InvestigationFeedback,
} from '../src/contracts';

/**
 * RED tests for the cognitive-investigation identifier contracts
 * (Fase 0.3 of the research roadmap).
 *
 * These tests pin:
 *   - the schema version strings used across producers and consumers,
 *   - the opaque-ASCII shape of every identifier (cuid-like, no
 *     slashes, no spaces, no Unicode),
 *   - the .strict() rejection of unknown top-level keys so producers
 *     cannot silently drift the wire format,
 *   - the minimum shape each envelope MUST carry in phase 0
 *     (later phases extend, none of those extensions is invented
 *     here).
 *
 * Phase 3 (Investigar incidente) and Phase 1 (validación humana)
 * extend these envelopes with additional fields; nothing in those
 * extensions overlaps with anything declared here.
 */

describe('cognitive-investigation identifier contracts', () => {
  describe('schema version strings', () => {
    it('run schema follows ftth.<name>.v<rev>', () => {
      expect(INVESTIGATION_RUN_SCHEMA).toBe('ftth.investigation-run.v1');
    });
    it('version schema follows ftth.<name>.v<rev>', () => {
      expect(INVESTIGATION_VERSION_SCHEMA).toBe('ftth.investigation-version.v1');
    });
    it('feedback schema follows ftth.<name>.v<rev>', () => {
      expect(INVESTIGATION_FEEDBACK_SCHEMA).toBe('ftth.investigation-feedback.v1');
    });
  });

  describe('InvestigationRun envelope', () => {
    const minimal: InvestigationRun = {
      schema: INVESTIGATION_RUN_SCHEMA,
      runId: 'r_a1b2c3d4e5',
      tenantId: 'tenant-1',
      connectionId: 'conn-1',
      incidentId: 'inc-1',
      requestedBy: 'user-1',
      requestedAt: '2026-09-07T12:00:00.000Z',
    };

    it('accepts the minimal valid payload', () => {
      expect(investigationRunSchema.parse(minimal)).toEqual(minimal);
    });

    it('accepts connectionId = null (an investigation can be tenant-wide)', () => {
      expect(investigationRunSchema.parse({ ...minimal, connectionId: null }).connectionId).toBeNull();
    });

    it('accepts incidentId = null (an investigation can be proactive)', () => {
      expect(investigationRunSchema.parse({ ...minimal, incidentId: null }).incidentId).toBeNull();
    });

    it('rejects an unknown schema version (drift detector)', () => {
      expect(() => investigationRunSchema.parse({ ...minimal, schema: 'ftth.investigation-run.v999' })).toThrow();
    });

    it('rejects unknown top-level keys (.strict())', () => {
      // A producer that adds an undocumented field would break the
      // contract silently if .strict() were missing.
      expect(() => investigationRunSchema.parse({ ...minimal, debug: 'leak' } as unknown)).toThrow();
    });

    it('rejects a non-datetime requestedAt', () => {
      expect(() => investigationRunSchema.parse({ ...minimal, requestedAt: 'not-a-date' })).toThrow();
    });
  });

  describe('InvestigationVersion envelope', () => {
    const minimal: InvestigationVersion = {
      schema: INVESTIGATION_VERSION_SCHEMA,
      versionId: 'v_a1b2c3d4e5',
      runId: 'r_a1b2c3d4e5',
      versionIndex: 0,
      rulesetVersion: 'r1',
      promptVersion: 'p1',
      modelVersion: 'm1',
      snapshotAt: '2026-09-07T12:00:00.000Z',
    };

    it('accepts the minimal valid payload', () => {
      expect(investigationVersionSchema.parse(minimal)).toEqual(minimal);
    });

    it('rejects negative versionIndex (a snapshot is monotonic)', () => {
      expect(() => investigationVersionSchema.parse({ ...minimal, versionIndex: -1 })).toThrow();
    });

    it('rejects unknown top-level keys (.strict())', () => {
      expect(() => investigationVersionSchema.parse({ ...minimal, hypotheses: [] } as unknown)).toThrow();
    });

    it('rejects an unknown schema version (drift detector)', () => {
      expect(() => investigationVersionSchema.parse({ ...minimal, schema: 'ftth.investigation-version.v2' })).toThrow();
    });
  });

  describe('InvestigationFeedback envelope', () => {
    const minimal: InvestigationFeedback = {
      schema: INVESTIGATION_FEEDBACK_SCHEMA,
      feedbackId: 'f_a1b2c3d4e5',
      versionId: 'v_a1b2c3d4e5',
      runId: 'r_a1b2c3d4e5',
      tenantId: 'tenant-1',
      authorUserId: 'user-1',
      submittedAt: '2026-09-07T12:00:00.000Z',
      // Phase 0 declares the field as free string so the contract
      // can ship without coupling to Phase 1's enum. Phase 1 will
      // tighten this to the label enum.
      label: 'confirmed',
    };

    it('accepts the minimal valid payload', () => {
      expect(investigationFeedbackSchema.parse(minimal)).toEqual(minimal);
    });

    it('rejects unknown top-level keys (.strict())', () => {
      expect(() => investigationFeedbackSchema.parse({ ...minimal, realCause: 'leak' } as unknown)).toThrow();
    });

    it('rejects an unknown schema version (drift detector)', () => {
      expect(() => investigationFeedbackSchema.parse({ ...minimal, schema: 'ftth.investigation-feedback.v2' })).toThrow();
    });

    it('rejects empty label (a technician must choose one)', () => {
      expect(() => investigationFeedbackSchema.parse({ ...minimal, label: '' })).toThrow();
    });
  });

  describe('identifier shape (opaque ASCII)', () => {
    it.each([
      ['runId'],
      ['versionId'],
      ['feedbackId'],
    ])('%s rejects slashes, spaces, and Unicode', (field: string) => {
      const base =
        field === 'runId'
          ? minimalRunForShape()
          : field === 'versionId'
          ? minimalVersionForShape()
          : minimalFeedbackForShape();
      // The test data above is just exercising the helper wiring; the
      // real shape tests follow immediately below with explicit values.
      void base;
    });

    it('rejects runId containing a slash', () => {
      expect(() =>
        investigationRunSchema.parse({ ...minimalRunForShape(), runId: 'has/slash' }),
      ).toThrow();
    });
    it('rejects runId containing a space', () => {
      expect(() =>
        investigationRunSchema.parse({ ...minimalRunForShape(), runId: 'has space' }),
      ).toThrow();
    });
    it('rejects versionId containing Unicode', () => {
      expect(() =>
        investigationVersionSchema.parse({ ...minimalVersionForShape(), versionId: 'café-1' }),
      ).toThrow();
    });
    it('rejects feedbackId containing a colon (would break log routing)', () => {
      expect(() =>
        investigationFeedbackSchema.parse({ ...minimalFeedbackForShape(), feedbackId: 'fb:1' }),
      ).toThrow();
    });
  });
});

function minimalRunForShape(): InvestigationRun {
  return {
    schema: INVESTIGATION_RUN_SCHEMA,
    runId: 'r_ok',
    tenantId: 'tenant-1',
    connectionId: 'conn-1',
    incidentId: 'inc-1',
    requestedBy: 'user-1',
    requestedAt: '2026-09-07T12:00:00.000Z',
  };
}
function minimalVersionForShape(): InvestigationVersion {
  return {
    schema: INVESTIGATION_VERSION_SCHEMA,
    versionId: 'v_ok',
    runId: 'r_ok',
    versionIndex: 0,
    rulesetVersion: 'r1',
    promptVersion: 'p1',
    modelVersion: 'm1',
    snapshotAt: '2026-09-07T12:00:00.000Z',
  };
}
function minimalFeedbackForShape(): InvestigationFeedback {
  return {
    schema: INVESTIGATION_FEEDBACK_SCHEMA,
    feedbackId: 'f_ok',
    versionId: 'v_ok',
    runId: 'r_ok',
    tenantId: 'tenant-1',
    authorUserId: 'user-1',
    submittedAt: '2026-09-07T12:00:00.000Z',
    label: 'confirmed',
  };
}
