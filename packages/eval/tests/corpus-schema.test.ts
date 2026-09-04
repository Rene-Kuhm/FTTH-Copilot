import { describe, expect, it } from 'vitest';
import {
  evalCaseSchema,
  evalCorpusSchema,
  type EvalCase,
  type EvalCorpus,
} from '../src/corpus-schema';

/**
 * Phase F-2 — `ftth.eval-corpus.v1` zod schema golden tests.
 *
 * The schema is the contract that ties the committable corpus JSON to the
 * Phase F-4 runner. Every red/pink case MUST validate against this
 * schema; any rejection here propagates to a PR-block via the runner.
 *
 * RED proof: before `corpus-schema.ts` exists, importing the barrel
 * throws `ERR_MODULE_NOT_FOUND` and every test in this file fails.
 */
describe('@ftth-copilot/eval — corpus schema (ftth.eval-corpus.v1)', () => {
  const baseCase: EvalCase = {
    id: 'case-001',
    surface: 'user-message',
    userMessage: 'How is OLT-001 doing?',
    expectedGate: 'allow',
  };

  describe('evalCaseSchema', () => {
    it('accepts a minimal case (only required fields)', () => {
      const result = evalCaseSchema.safeParse(baseCase);
      expect(result.success).toBe(true);
    });

    it('accepts every mapped surface value', () => {
      const surfaces = [
        'user-message',
        'conversation-history',
        'tool-args',
        'connector-payload',
        'retrieval-block',
        'system-assembly',
        'prediction-provider',
      ] as const;
      for (const surface of surfaces) {
        const result = evalCaseSchema.safeParse({ ...baseCase, surface });
        expect(result.success, `surface=${surface}`).toBe(true);
      }
    });

    it('accepts a case with toolMocks and an injectionKind', () => {
      const result = evalCaseSchema.safeParse({
        ...baseCase,
        surface: 'tool-args',
        toolMocks: [{ toolName: 'get_onu_detail', returns: { id: 'ONU-0001-test' } }],
        injectionKind: 'customer-name-smuggle',
        expectedGate: 'warn',
      });
      expect(result.success).toBe(true);
    });

    it('accepts every InjectionKind enum value when present', () => {
      const kinds = [
        'direct-override',
        'role-reassignment',
        'customer-name-smuggle',
        'connector-payload-smuggle',
        'retrieval-row-smuggle',
        'prediction-smuggle',
        'system-injection',
      ] as const;
      for (const injectionKind of kinds) {
        const result = evalCaseSchema.safeParse({
          ...baseCase,
          injectionKind,
        });
        expect(result.success, `injectionKind=${injectionKind}`).toBe(true);
      }
    });

    it('accepts every ExpectedGate enum value', () => {
      const gates = ['allow', 'warn', 'abstain'] as const;
      for (const expectedGate of gates) {
        const result = evalCaseSchema.safeParse({ ...baseCase, expectedGate });
        expect(result.success, `expectedGate=${expectedGate}`).toBe(true);
      }
    });

    it('rejects an unknown surface value', () => {
      const result = evalCaseSchema.safeParse({ ...baseCase, surface: 'unmapped' });
      expect(result.success).toBe(false);
    });

    it('rejects an unknown expectedGate value', () => {
      const result = evalCaseSchema.safeParse({ ...baseCase, expectedGate: 'pass' });
      expect(result.success).toBe(false);
    });

    it('rejects an unknown injectionKind value', () => {
      const result = evalCaseSchema.safeParse({
        ...baseCase,
        injectionKind: 'prompt-leak',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an empty id', () => {
      const result = evalCaseSchema.safeParse({ ...baseCase, id: '' });
      expect(result.success).toBe(false);
    });

    it('rejects an empty userMessage', () => {
      const result = evalCaseSchema.safeParse({ ...baseCase, userMessage: '' });
      expect(result.success).toBe(false);
    });

    it('rejects a missing id', () => {
      const { id: _ignored, ...rest } = baseCase;
      const result = evalCaseSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('rejects an unknown top-level key (strict mode)', () => {
      const result = evalCaseSchema.safeParse({ ...baseCase, evil: 'surprise' });
      expect(result.success).toBe(false);
    });

    it('round-trips a complex case via safeParse + JSON', () => {
      const original: EvalCase = {
        id: 'case-rt-001',
        surface: 'connector-payload',
        userMessage: 'What does the ONU look like?',
        toolMocks: [{ toolName: 'get_onu_detail', returns: { status: 'online' } }],
        expectedGate: 'warn',
        injectionKind: 'connector-payload-smuggle',
      };
      const json = JSON.parse(JSON.stringify(original));
      const result = evalCaseSchema.safeParse(json);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(original);
      }
    });
  });

  describe('evalCorpusSchema', () => {
    const oneCasePerSurface: EvalCorpus = {
      schema: 'ftth.eval-corpus.v1',
      version: 1,
      cases: [
        { id: 'p1', surface: 'user-message', userMessage: 'a', expectedGate: 'allow' },
        {
          id: 'p2',
          surface: 'conversation-history',
          userMessage: 'b',
          expectedGate: 'allow',
        },
        { id: 'p3', surface: 'tool-args', userMessage: 'c', expectedGate: 'allow' },
        {
          id: 'p4',
          surface: 'connector-payload',
          userMessage: 'd',
          expectedGate: 'allow',
        },
        {
          id: 'p5',
          surface: 'retrieval-block',
          userMessage: 'e',
          expectedGate: 'allow',
        },
        {
          id: 'p6',
          surface: 'system-assembly',
          userMessage: 'f',
          expectedGate: 'allow',
        },
        {
          id: 'p7',
          surface: 'prediction-provider',
          userMessage: 'g',
          expectedGate: 'allow',
        },
      ],
    };

    it('accepts a valid envelope with one case per surface', () => {
      const result = evalCorpusSchema.safeParse(oneCasePerSurface);
      expect(result.success).toBe(true);
    });

    it('rejects the wrong schema literal', () => {
      const result = evalCorpusSchema.safeParse({
        ...oneCasePerSurface,
        schema: 'ftth.eval-corpus.v2',
      });
      expect(result.success).toBe(false);
    });

    it('rejects the wrong version literal', () => {
      const result = evalCorpusSchema.safeParse({ ...oneCasePerSurface, version: 2 });
      expect(result.success).toBe(false);
    });

    it('rejects an empty cases array (min 1)', () => {
      const result = evalCorpusSchema.safeParse({
        ...oneCasePerSurface,
        cases: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects an unknown top-level key (strict mode)', () => {
      const result = evalCorpusSchema.safeParse({
        ...oneCasePerSurface,
        surprise: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects when any nested case is malformed', () => {
      const result = evalCorpusSchema.safeParse({
        ...oneCasePerSurface,
        cases: [
          ...oneCasePerSurface.cases,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { id: 'bad', surface: 'unmapped', userMessage: 'x', expectedGate: 'allow' } as any,
        ],
      });
      expect(result.success).toBe(false);
    });
  });
});
