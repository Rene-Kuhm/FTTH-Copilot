/**
 * Phase F-4.2 — corpus runner.
 *
 * `runCase` drives `runAgent` against a single corpus entry. The LLM seam
 * (`createLlmClient`) is injected through `deps` so the runner stays
 * keyless: the PR leg (`packages/eval`) mocks the LLM factory, the
 * nightly leg (`eval-nightly.yml`) injects a real client. The runner
 * never reads API keys itself.
 *
 * Gate-decision computation is delegated to `@ftth-copilot/evidence`'s
 * `shouldAbstain` — the runner does NOT replicate the policy. The
 * `gateDecision` returned in `EvalRunResult` is the public surface the
 * assertions layer consumes; `pass` is a simple equality check against
 * `case.expectedGate`.
 */

import type { AgentResult } from '@ftth-copilot/shared';
import {
  shouldAbstain,
  type AbstentionTenantPolicy,
  type TruthGateMode,
  type Verdict,
} from '@ftth-copilot/evidence';
import type { EvalCase } from './corpus-schema';

/**
 * Per-runner dependency bag. `runAgent` is injectable so the runner
 * stays keyless: tests pass a `vi.fn()`; the nightly leg passes the
 * real agent-core `runAgent` reference.
 */
export interface RunnerDeps {
  /**
   * The `runAgent` function from `@ftth-copilot/agent-core`. Tests pass a
   * stub; production passes the real export. The runner treats it as a
   * pure `(opts) => Promise<AgentResult>` shape.
   */
  runAgent: (opts: Record<string, unknown>) => Promise<AgentResult>;
  /**
   * The LLM client produced by `createLlmClient` (Fase B seam). Carried
   * for symmetry with the F-4 spec; the keyless test path does not
   * consume it because the stubbed `runAgent` short-circuits the LLM
   * call. Production runners may consult this to script per-case LLM
   * responses.
   */
  llm?: unknown;
}

/**
 * The decision the runner computed from `agentResult.verdicts` via
 * `shouldAbstain`. Mirrors `AbstentionDecision` from
 * `@ftth-copilot/evidence` so the assertions layer can map
 * `expectedGate` → `gateDecision` verbatim.
 */
export type GateDecision = 'allow' | 'warn' | 'abstain';

/**
 * Per-case result. `case` is the original entry, `agentResult` is the
 * raw `AgentResult` returned by `runAgent`, `gateDecision` is the
 * runner's verdict-derived decision, `pass` is
 * `gateDecision === case.expectedGate`.
 *
 * The shape is the single source of truth for the assertions layer
 * (`attackPassRate`, `assertCoverage`, `assertInjectionKindsCovered`)
 * and the nightly metrics builder.
 */
export interface EvalRunResult {
  case: EvalCase;
  agentResult: AgentResult;
  gateDecision: GateDecision;
  pass: boolean;
}

/**
 * Aggregate of every `EvalRunResult` produced for a corpus. `casesRun`
 * mirrors `results.length` but is surfaced separately so the assertions
 * layer can report a quick count without iterating.
 */
export interface EvalRunSummary {
  casesRun: number;
  results: EvalRunResult[];
}

/**
 * Computes the gate decision from the verdicts returned by `runAgent`.
 * Pure function over `verdicts` + the active mode + an optional tenant
 * policy knob. Delegates the actual decision logic to `shouldAbstain`
 * so the runner NEVER diverges from `finalize`'s policy.
 *
 * The active mode is `strict` by default — the PR corpus asserts the
 * F-3 strict-mode contract. A future caller may override to `observe`
 * for white-box coverage tests; the function is intentionally pure.
 */
export function computeGateDecision(
  verdicts: Verdict[] | undefined,
  mode: TruthGateMode = 'strict',
  tenantPolicy?: AbstentionTenantPolicy,
): GateDecision {
  return shouldAbstain(verdicts ?? [], mode, tenantPolicy);
}

/**
 * Build the `RunAgentOptions`-shaped payload from a corpus case. The
 * runner does NOT import the agent-core types directly — that would
 * pull the entire runtime into the test surface. Instead we ship a
 * structural shape that `runAgent` is contractually free to consume.
 *
 * Field map:
 *   - userMessage        → `case.userMessage`
 *   - mode               → strict (F-3 contract; PR leg asserts strict behavior)
 *   - toolMocks          → `case.toolMocks` (production runner scripts the
 *                          connector via `withToolResults`; the test stub
 *                          ignores this field)
 *   - __evalCaseId       → `case.id` (test-only hint; lets a stubbed
 *                          `runAgent` produce matching verdicts without
 *                          inspecting userMessage content)
 *   - __expectedGate     → `case.expectedGate` (test-only hint; same as
 *                          above)
 *
 * The `__eval*` keys are underscore-prefixed so it's obvious they are
 * runner-internal and never enter the production data path. The real
 * agent-core `runAgent` ignores unknown options; the contract is
 * structural.
 */
export function caseToRunAgentOptions(case_: EvalCase): Record<string, unknown> {
  return {
    userMessage: case_.userMessage,
    mode: 'strict' as TruthGateMode,
    toolMocks: case_.toolMocks ?? [],
    __evalCaseId: case_.id,
    __expectedGate: case_.expectedGate,
  };
}

/**
 * Runs a single corpus case. The test contract is `deps.runAgent(opts)`
 * returns the AgentResult; `runCase` computes the gate decision from
 * the verdicts and the expected gate.
 *
 * `case_.expectedGate` is the contract the assertions layer asserts
 * against; `pass` is the strict equality check (no fuzzy matching).
 */
export async function runCase(
  case_: EvalCase,
  deps: RunnerDeps,
): Promise<EvalRunResult> {
  const opts = caseToRunAgentOptions(case_);
  const agentResult = await deps.runAgent(opts);
  const gateDecision = computeGateDecision(agentResult.verdicts);
  return {
    case: case_,
    agentResult,
    gateDecision,
    pass: gateDecision === case_.expectedGate,
  };
}

/**
 * Runs every case in the corpus sequentially. Sequential is intentional
 * — vitest is single-threaded and the test corpus is small (~14 cases).
 * A future nightly leg with real LLMs may want to parallelize, but the
 * PR gate MUST stay deterministic so CI flakes never mask real bugs.
 */
export async function runCorpus(
  corpus: { cases: EvalCase[] },
  deps: RunnerDeps,
): Promise<EvalRunSummary> {
  const results: EvalRunResult[] = [];
  for (const case_ of corpus.cases) {
    results.push(await runCase(case_, deps));
  }
  return { casesRun: results.length, results };
}
