import { describe, expect, it } from 'vitest';
import {
  FROZEN_PILOT_EVAL_DATASET,
  pilotFrozenEvalDatasetSchema,
  validatePilotExecutionMetadata,
  type PilotExecutionMetadata,
} from '../src/pilot-frozen-dataset';

describe('Frozen Pilot Evaluation Dataset & Execution Traceability (Roadmap Fase 7 — 7.2)', () => {
  it('strictly validates the frozen dataset schema against zod', () => {
    const parsed = pilotFrozenEvalDatasetSchema.parse(FROZEN_PILOT_EVAL_DATASET);
    expect(parsed.version).toBe(1);
    expect(parsed.cases.length).toBeGreaterThanOrEqual(7);
  });

  it('ensures distinct non-overlapping caseIds within the dataset', () => {
    const ids = FROZEN_PILOT_EVAL_DATASET.cases.map((c) => c.caseId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('validates complete execution metadata with model, prompt, rules and sources', () => {
    const validMeta: PilotExecutionMetadata = {
      modelVersion: 'gemini-1.5-pro-002',
      promptVersion: 'prompts.investigation.v2.1',
      rulesVersion: 'rules.topology.v1.4',
      sources: ['snmp-traps', 'optical-metrics', 'topology-db'],
      runtimeConfig: { temperature: 0.1, timeoutMs: 5000 },
      executedAt: '2026-09-10T12:00:00.000Z',
    };

    expect(validatePilotExecutionMetadata(validMeta)).toBe(true);
  });

  it('rejects execution metadata if any mandatory provenance field is missing', () => {
    const invalidMeta: PilotExecutionMetadata = {
      modelVersion: '', // missing
      promptVersion: 'prompts.v1',
      rulesVersion: 'rules.v1',
      sources: [],
      runtimeConfig: {},
      executedAt: 'invalid-date',
    };

    expect(validatePilotExecutionMetadata(invalidMeta)).toBe(false);
  });
});
