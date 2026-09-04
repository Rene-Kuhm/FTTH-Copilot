/**
 * Phase F-4.2 — runner tests (keyless execution).
 *
 * The runner drives `runAgent` against the corpus using a stubbed `runAgent`
 * injected through the call signature (per F-4 task spec). The tests assert
 * the gate-decision computation matches `shouldAbstain` semantics and the
 * `pass` flag reflects the case's `expectedGate`.
 *
 * RED proof: before `src/runner.ts` exists, every assertion below fails
 * because the named exports are `undefined`. GREEN proof: after the
 * runner ships, the typed surface round-trips pink + red corpora and the
 * `gateDecision` matches the abstention policy verbatim.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AgentResult } from '@ftth-copilot/shared';
import type { Verdict } from '@ftth-copilot/evidence';
import { loadPinkCorpus, loadRedCorpus } from '../src/corpus-loader';
import { runCase, runCorpus, type EvalRunResult } from '../src/runner';
import { attackPassRate, assertAttackPassRateIsOne } from '../src/assertions';

/**
 * Stub `runAgent` factory: returns the verdicts the test wants; the runner
 * only inspects `agentResult.verdicts` + `agentResult.text` / `toolCalls`
 * to compute the gate decision. The same seam the F-4 spec demands (no
 * real LLM call).
 *
 * The runner passes `__expectedGate` + `__evalCaseId` as runner-internal
 * hints (see `caseToRunAgentOptions`); the stub reads `__expectedGate` and
 * emits matching verdicts so a corpus-level test can drive every case
 * through the right gate without per-case stubs.
 */
type StubArgs = { verdicts?: Verdict[]; text?: string };
function makeStubRunAgent({ verdicts, text = 'OK' }: StubArgs = {}) {
  return vi.fn(async (opts?: Record<string, unknown>): Promise<AgentResult> => {
    if (verdicts) {
      return { text, toolCalls: [], verdicts };
    }
    const expectedGate = opts?.['__expectedGate'] as string | undefined;
    let matchingVerdicts: Verdict[] = [];
    if (expectedGate === 'abstain') {
      matchingVerdicts = [
        { toolName: 'stub', code: 'incomplete', reason: 'no-envelope', severity: 'critical' },
      ];
    } else if (expectedGate === 'warn') {
      matchingVerdicts = [
        { toolName: 'stub', code: 'stale', reason: 'stale-evidence', severity: 'warning' },
      ];
    } else {
      matchingVerdicts = [];
    }
    return { text, toolCalls: [], verdicts: matchingVerdicts };
  });
}

describe('@ftth-copilot/eval — runner (F-4.2)', () => {
  describe('runCase', () => {
    it('computes gateDecision=allow when verdicts are empty (or only ok)', async () => {
      const stub = makeStubRunAgent({ verdicts: [] });
      const result = await runCase(
        {
          id: 'pink-empty-001',
          surface: 'user-message',
          userMessage: 'hola',
          expectedGate: 'allow',
        },
        { runAgent: stub },
      );
      expect(stub).toHaveBeenCalledTimes(1);
      expect(result.pass).toBe(true);
      expect(result.gateDecision).toBe('allow');
      expect(result.case.id).toBe('pink-empty-001');
      expect(result.agentResult.verdicts).toEqual([]);
    });

    it('computes gateDecision=warn when at least one verdict is stale', async () => {
      const stub = makeStubRunAgent({
        verdicts: [
          { toolName: 'list_onus', code: 'stale', reason: 'stale-evidence', severity: 'warning' },
        ],
      });
      const result = await runCase(
        {
          id: 'pink-stale-001',
          surface: 'user-message',
          userMessage: 'stale',
          expectedGate: 'warn',
        },
        { runAgent: stub },
      );
      expect(result.gateDecision).toBe('warn');
      expect(result.pass).toBe(true);
    });

    it('computes gateDecision=warn when at least one verdict is low_confidence', async () => {
      const stub = makeStubRunAgent({
        verdicts: [
          {
            toolName: 'list_onus',
            code: 'low_confidence',
            reason: 'low-confidence',
            severity: 'warning',
          },
        ],
      });
      const result = await runCase(
        {
          id: 'pink-low-001',
          surface: 'user-message',
          userMessage: 'low',
          expectedGate: 'warn',
        },
        { runAgent: stub },
      );
      expect(result.gateDecision).toBe('warn');
      expect(result.pass).toBe(true);
    });

    it('computes gateDecision=abstain when at least one verdict is incomplete', async () => {
      const stub = makeStubRunAgent({
        verdicts: [
          {
            toolName: 'get_onu_detail',
            code: 'incomplete',
            reason: 'no-envelope',
            severity: 'critical',
          },
        ],
      });
      const result = await runCase(
        {
          id: 'red-incomplete-001',
          surface: 'connector-payload',
          userMessage: 'incomplete',
          expectedGate: 'abstain',
        },
        { runAgent: stub },
      );
      expect(result.gateDecision).toBe('abstain');
      expect(result.pass).toBe(true);
    });

    it('flags pass=false when the stub returns a different verdict than the case expects', async () => {
      const stub = makeStubRunAgent({ verdicts: [] }); // gateDecision=allow
      const result = await runCase(
        {
          id: 'mismatch-001',
          surface: 'user-message',
          userMessage: 'mismatch',
          expectedGate: 'abstain',
        },
        { runAgent: stub },
      );
      expect(result.pass).toBe(false);
      expect(result.gateDecision).toBe('allow');
      expect(result.case.expectedGate).toBe('abstain');
    });

    it('captures the full AgentResult (text + toolCalls + verdicts) on the run result', async () => {
      const stub = makeStubRunAgent({
        verdicts: [
          { toolName: 'list_olts', code: 'ok', reason: 'fresh-evidence', severity: 'ok' },
        ],
        text: 'respuesta',
      });
      const result = await runCase(
        {
          id: 'shape-001',
          surface: 'user-message',
          userMessage: 'shape',
          expectedGate: 'allow',
        },
        { runAgent: stub },
      );
      expect(result.agentResult.text).toBe('respuesta');
      expect(result.agentResult.toolCalls).toEqual([]);
      expect(result.agentResult.verdicts).toEqual([
        { toolName: 'list_olts', code: 'ok', reason: 'fresh-evidence', severity: 'ok' },
      ]);
    });
  });

  describe('runCorpus', () => {
    it('returns one result per case in the corpus', async () => {
      const stub = makeStubRunAgent({ verdicts: [] }); // allow → all pink pass
      const summary = await runCorpus(loadPinkCorpus(), { runAgent: stub });
      expect(summary.casesRun).toBe(loadPinkCorpus().cases.length);
      expect(summary.results).toHaveLength(loadPinkCorpus().cases.length);
    });

    it('all pink cases pass when the stub returns matching verdicts', async () => {
      // Pink cases expect `allow` → stub with [] verdicts → all pass.
      const stub = makeStubRunAgent({ verdicts: [] });
      const summary = await runCorpus(loadPinkCorpus(), { runAgent: stub });
      expect(attackPassRate(summary)).toBe(1.0);
      // No throw → strict 100% gate satisfied.
      expect(() => assertAttackPassRateIsOne(summary)).not.toThrow();
    });

    it('all red cases pass when the stub returns matching verdicts', async () => {
      // Red cases mix warn/abstain expected gates. The stub reads the
      // runner-internal `__expectedGate` hint and emits matching verdicts
      // (warn → stale; abstain → incomplete; allow → []); every red
      // case passes.
      const stub = makeStubRunAgent();
      const summary = await runCorpus(loadRedCorpus(), { runAgent: stub });
      expect(summary.casesRun).toBeGreaterThanOrEqual(7);
      expect(attackPassRate(summary)).toBe(1.0);
    });

    it('attackPassRate < 1.0 when at least one red case fails the gate', async () => {
      // Stub always returns allow (empty verdicts) → every red case with
      // `expectedGate: 'warn' | 'abstain'` mismatches and fails.
      const stub = makeStubRunAgent({ verdicts: [] });
      const summary = await runCorpus(loadRedCorpus(), { runAgent: stub });
      expect(attackPassRate(summary)).toBeLessThan(1.0);
      // The strict assertion MUST throw so the CI gate fires.
      expect(() => assertAttackPassRateIsOne(summary)).toThrow();
    });

    it('passes the result envelope (case + agentResult + gateDecision + pass)', async () => {
      const stub = makeStubRunAgent({ verdicts: [] });
      const summary = await runCorpus(loadPinkCorpus(), { runAgent: stub });
      for (const r of summary.results as EvalRunResult[]) {
        expect(r.case).toBeDefined();
        expect(r.agentResult).toBeDefined();
        expect(['allow', 'warn', 'abstain']).toContain(r.gateDecision);
        expect(typeof r.pass).toBe('boolean');
      }
    });
  });
});
