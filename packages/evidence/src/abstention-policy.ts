/**
 * Abstention policy — Fase C strict-mode asymmetric enforcement.
 *
 * Pure functions over `Verdict[]`. `shouldAbstain` answers the central
 * question "does the current evidence permit an answer?" — the answer is
 * strictly a function of the verdict codes emitted by Fase B's classifier
 * and the active `TruthGateMode`. `buildAbstention` and `nextStepFor` turn
 * that decision into a deterministic operator-facing envelope and Spanish
 * remediation hint.
 *
 * No source-branching: demo envelopes (`*.demo`) and live envelopes
 * (`*.poll`) flow through the same `classifyEnvelope` path (Fase B
 * invariant), and `buildAbstention` consumes the resulting verdicts
 * uniformly. There is no mode-conditional threshold in the policy itself.
 */
import { ABSTENTION_SCHEMA, type Abstention } from '@ftth-copilot/shared';
import type { Verdict, VerdictCode, VerdictSeverity } from './types';

export type { Verdict, VerdictSeverity };

export type TruthGateMode = 'observe' | 'strict';

export type AbstentionDecision = 'allow' | 'warn' | 'abstain';

/**
 * Fase E — minimal slice of `TenantPolicy` consulted by `shouldAbstain`.
 * Defined structurally so the evidence package never pulls the Prisma
 * row through its import graph (and so the test surface can pass any
 * `{ abstainOnCodes: [...] }` shape without standing up a row).
 */
export interface AbstentionTenantPolicy {
  readonly abstainOnCodes?: ReadonlyArray<VerdictCode>;
}

// ── Spanish nextStep templates (Argentine rioplatense voseo) ─────────────────
//
// These two template builders produce the canonical remediation hint
// rendered by the ChatUI bubble. Snapshot-locked by
// `abstention-policy.test.ts`. The verbs (`verificá`, `recolectá`, `volvé`)
// match the voseo voice used in `prompts/system.ts:1-52` so the operator
// sees one consistent register across the product. Each template
// interpolates the joined `toolsAffected` list so the message references
// the specific tool that failed (per spec scenario "voseo + tool
// reference + determinism").

export function formatIdentifierNextStep(toolsAffected: string[]): string {
  return `No pude respaldar el diagnóstico: el identificador ${toolsAffected.join(', ')} no figura en el NMS. Verificá el identificador (ID, SN o filtro) y volvé a intentar.`;
}

export function formatMetricsNextStep(toolsAffected: string[]): string {
  return `No pude respaldar el diagnóstico: las métricas ${toolsAffected.join(', ')} están vencidas o incompletas. Re-colectá datos frescos de los últimos 15 minutos antes de diagnosticar.`;
}

// ── Policy ────────────────────────────────────────────────────────────────────

/**
 * Asymmetric policy table. Strict mode:
 *   - any `incomplete` verdict → `'abstain'`
 *   - else any `stale` / `low_confidence` → `'warn'`
 *   - else → `'allow'`
 * Observe mode (legacy Fase B behaviour): always `'allow'`. The gate never
 * blocks data flow; `runAgent` always passes the raw tool result string to
 * the LLM as-is when in observe.
 *
 * No source-branching on `verdicts[i].toolName` or any envelope field —
 * decisions are made purely on the verdict codes already aggregated by
 * `classifyEnvelope`. Demo == live parity is preserved.
 *
 * Fase E — trailing optional `tenantPolicy`. When defined, the abstention
 * trigger set becomes `tenantPolicy.abstainOnCodes`:
 *   - `undefined` → Fase C byte-identical (incomplete triggers abstain)
 *   - defined (possibly empty) → triggers on those codes instead
 *   - `[]` → never abstain (per-tenant override disables the gate)
 *
 * Observe mode still always returns `'allow'` — the policy never short-
 * circuits Fase B. `shouldAbstain` is intentionally pure: it never reads
 * env, never touches Prisma, and never logs.
 */
export function shouldAbstain(
  verdicts: Verdict[],
  mode: TruthGateMode,
  tenantPolicy?: AbstentionTenantPolicy,
): AbstentionDecision {
  if (mode === 'observe') return 'allow';
  const triggerCodes: ReadonlyArray<VerdictCode> | undefined =
    tenantPolicy?.abstainOnCodes !== undefined ? tenantPolicy.abstainOnCodes : undefined;
  // When `tenantPolicy` is undefined → fall through to the Fase C default
  // (incomplete). When it is defined (even `[]`) → use it verbatim.
  const active = triggerCodes;
  if (active !== undefined) {
    for (const v of verdicts) {
      if (active.includes(v.code)) return 'abstain';
    }
    for (const v of verdicts) {
      if (v.code === 'stale' || v.code === 'low_confidence') return 'warn';
    }
    return 'allow';
  }
  for (const v of verdicts) {
    if (v.code === 'incomplete') return 'abstain';
  }
  for (const v of verdicts) {
    if (v.code === 'stale' || v.code === 'low_confidence') return 'warn';
  }
  return 'allow';
}

// ── Derivation ───────────────────────────────────────────────────────────────

function distinct(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

/**
 * Builds the `ftth.abstention.v1` envelope from a verdict set.
 *
 * Contract:
 * - When `triggerCode` is omitted (the Fase C call path) the function
 *   requires at least one `incomplete` verdict — the precondition is
 *   hard-enforced and the call site MUST consult `shouldAbstain` first.
 * - When `triggerCode` is supplied (the Fase E call path) the function
 *   requires at least one verdict whose code matches it; the envelope
 *   is built against those matching verdicts so the abstention can be
 *   emitted even when the trigger is `stale` or `low_confidence`.
 * - `missing` is the distinct set of toolNames that emitted verdicts
 *   matching the trigger code.
 * - `available` is the distinct set of toolNames that emitted `ok`
 *   verdicts. May be empty when every tool in the run failed.
 * - `toolsAffected` is the distinct union of toolNames across every
 *   non-`ok` verdict (includes `stale` and `low_confidence`).
 * - `reason` equals the trigger code (literal VerdictCode).
 * - `severity` is taken from the first matching verdict (matches the
 *   dominant failure surfaced to the operator).
 * - `claim` is forwarded as-is when provided; omitted otherwise.
 * - `nextStep` is delegated to `nextStepFor(reason, toolsAffected)`.
 *
 * Determinism: identical input verdict sets produce identical envelopes
 * (Fase B demo == live invariant honored here too).
 */
export function buildAbstention(
  verdicts: Verdict[],
  claim?: string,
  triggerCode: VerdictCode = 'incomplete',
): Abstention {
  const triggers = verdicts.filter((v) => v.code === triggerCode);
  if (triggers.length === 0) {
    throw new Error(
      `buildAbstention requires at least one "${triggerCode}" verdict; ` +
        'call only when shouldAbstain() === "abstain"',
    );
  }

  const missing = distinct(triggers.map((v) => v.toolName));
  const oks = verdicts.filter((v) => v.code === 'ok');
  const available = distinct(oks.map((v) => v.toolName));
  const nonOks = verdicts.filter((v) => v.code !== 'ok');
  const toolsAffected = distinct(nonOks.map((v) => v.toolName));

  const reason: VerdictCode = triggerCode;
  const severity: VerdictSeverity = triggers[0]!.severity;
  const nextStep = nextStepFor(reason, toolsAffected);

  return {
    schema: ABSTENTION_SCHEMA,
    reason,
    severity,
    claim,
    missing,
    available,
    nextStep,
    toolsAffected,
  };
}

// ── nextStep ─────────────────────────────────────────────────────────────────

const IDENTIFIER_HINT = /(?:onu|olt)/i;
const METRICS_HINT = /(?:metric|telemetry|history)/i;

/**
 * Returns the deterministic Spanish `nextStep` string for the abstention
 * bubble. The caller MUST be in the "we should abstain" branch — i.e.
 * `reason === 'incomplete'` — but the function stays defensive for any
 * future caller that passes another reason (returns the metrics template).
 *
 * Template selection (when `reason === 'incomplete'`):
 *   - any toolName matches `onu` or `olt` (identifier-style lookup) →
 *     `IDENTIFIER_NEXTSTEP` ("el identificador no figura en el NMS…").
 *   - otherwise (metrics / telemetry / history / no hint) →
 *     `METRICS_NEXTSTEP` ("las métricas están vencidas o incompletas…").
 *
 * The two strings are exported as constants so they can be referenced
 * directly from the snapshot tests and from the runtime formatter.
 */
export function nextStepFor(reason: string, toolsAffected: string[]): string {
  if (reason !== 'incomplete') {
    return formatMetricsNextStep(toolsAffected);
  }
  const hasIdentifierHint = toolsAffected.some((name) => IDENTIFIER_HINT.test(name));
  if (hasIdentifierHint) {
    return formatIdentifierNextStep(toolsAffected);
  }
  return formatMetricsNextStep(toolsAffected);
}