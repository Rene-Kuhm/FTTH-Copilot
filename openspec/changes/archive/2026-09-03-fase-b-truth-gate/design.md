# Design: Fase B — Truth Gate (observation mode)

## Technical Approach

A new `@ftth-copilot/evidence` package owns pure envelope classification. `runAgent` calls it after each `executeToolCall`, accumulates verdicts, and attaches them via a new optional `verdicts` field on `AgentResult`. Observe mode — verdicts recorded, but data to the LLM unchanged. One `classifyEnvelope` path serves demo and live identically.

## Architecture Decisions

### Decision: Where the `Verdict` type lives

| Option | Tradeoff | Decision |
|---|---|---|
| Define `Verdict` in `@ftth-copilot/shared` (with `EvidenceProvenance`) | Symmetric with Fase A | Rejected — proposal decides otherwise |
| Define `Verdict` in `@ftth-copilot/evidence/src/types.ts`; shared uses `import type` | Verdict owned by the package that produces it; shared stays free of runtime cross-package wiring | **Chosen** |

`packages/shared` gets `@ftth-copilot/evidence` as `devDependency` for type-only resolution.

### Decision: Single classification function, demo = live

| Option | Tradeoff | Decision |
|---|---|---|
| Two paths (lenient demo, strict live) | Threshold drift; calibration noise | Rejected |
| `classifyEnvelope(unknown, toolName, now?)` for both modes | Identical thresholds produce consistent Fase-C calibration data | **Chosen** |

### Decision: Verdict priority

Collect candidate verdicts; pick highest severity. Ranking `incomplete (3) > stale (2) > low_confidence (1) > ok (0)`. Returns `{ code, reason, severity, toolName }`. Conflicts: `stale + incomplete` → incomplete; `low_confidence + stale` → stale; all three non-ok → incomplete.

## Module: TruthGate (`@ftth-copilot/evidence`)

### Public API

```ts
export type VerdictCode = 'ok' | 'low_confidence' | 'stale' | 'incomplete';
export type VerdictSeverity = 'ok' | 'info' | 'warning' | 'critical';
export interface Verdict { toolName: string; code: VerdictCode; reason: string; severity: VerdictSeverity; }
export function classifyEnvelope(parsed: unknown, toolName: string, now?: Date): Verdict;
export function classifyUnwrapped(toolName: string): Verdict;
```

### Classification rules (independent, then severity-ranked)

1. **Envelope parse** — `evidenceProvenanceSchema.safeParse(parsed)` failure → `incomplete / parse-error / critical`.
2. **Completeness** — `'complete'` → ok; `'partial'` → `incomplete / partial-completeness / warning`; `'minimal'` → `incomplete / minimal-completeness / critical`.
3. **Staleness** — strict `now > observedAt + ttlMs` → `stale / expired-ttl / warning`.
4. **Confidence** — `undefined` → `low_confidence / missing-confidence / warning`; value `< 0.3` → `low_confidence / low-confidence-value / warning`; value `>= 0.3` → ok for confidence.
5. **Aggregation** — highest severity wins; all checks ok → `ok / fresh-complete / ok`.

## Data Flow

```
chat/route ─► runAgent
   │ per tool call: result = executeToolCall(...)
   │   verdicts.push(classifyToolResult(result, name, now))
   │   toolResultLines.push(`[tool_result] ${result}`)  ◄─ unchanged
   │   messages.push(toolResultLines) ─► LLM
   └──► AgentResult { text, toolCalls, verdicts }
```

`classifyToolResult`: try `JSON.parse`; fail or non-object → `classifyUnwrapped(name)`; success → `classifyEnvelope(parsed, name, now)`. Module-scope `now` per execution for testable injection.

## File Changes

| File | Action | Note |
|---|---|---|
| `packages/evidence/{package.json,tsconfig.json,vitest.config.ts}` | Create | Mirror `packages/security/`; runtime dep `@ftth-copilot/shared` |
| `packages/evidence/src/{types.ts,truth-gate.ts,index.ts}` | Create | Types; classifier + ranker; barrel |
| `packages/evidence/tests/truth-gate.test.ts` | Create | Table cases |
| `packages/agent-core/src/runtime.ts` | Modify | Gate helper + accumulator at both return paths |
| `packages/agent-core/src/index.ts` | Modify | Re-export `Verdict` + classifiers |
| `packages/agent-core/package.json` | Modify | `+@ftth-copilot/evidence: workspace:*` |
| `packages/agent-core/tests/runtime.test.ts` | Modify | Assert verdicts length + unchanged LLM payload |
| `packages/shared/src/index.ts` | Modify | `import type` Verdict; `AgentResult.verdicts?: Verdict[]` |
| `packages/shared/package.json` | Modify | `+@ftth-copilot/evidence: workspace:*` (devDep) |
| `turbo.json` | No change | `pnpm-workspace.yaml` auto-discovers |
| `openspec/config.yaml` | Modify | Add `packages/evidence` project entry |

## runAgent Wiring (around L83–91)

```ts
const verdicts: Verdict[] = [];
const now = new Date();
const classifyToolResult = (raw: string, name: string): Verdict => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return classifyUnwrapped(name); }
  if (parsed === null || typeof parsed !== 'object') return classifyUnwrapped(name);
  return classifyEnvelope(parsed, name, now);
};
// inside for-loop, after executeToolCall:
const result = await executeToolCall(connector, call.name, call.arguments, opts.predictionProvider, provenance);
verdicts.push(classifyToolResult(result, call.name));
toolCalls.push({ name: call.name, arguments: call.arguments, result });
toolResultLines.push(`[tool_result for ${call.name}] ${result}`); // observe: unchanged
// ...
return { text, toolCalls, verdicts }; // both return paths
```

## Testing Strategy

| Layer | Cases |
|---|---|
| Unit (evidence) | Fresh / stale / edge-equal / missing-confidence / 0.2 / 0.3 / 1.0 / complete / partial / minimal; demo == live verdict on identical fields; parse failure → `parse-error` |
| Unit (evidence) priority | stale+minimal → incomplete; missing-conf+expired → stale; all three → incomplete |
| Integration (agent-core) | 3 sequential tool calls → `verdicts.length === 3` AND `verdicts[i].toolName === toolCalls[i].name`; second LLM payload still contains the original stale `result` string verbatim |
| Regression | `AgentResult.text`/`toolCalls` assertions unchanged; `verdicts` optional |
| Workspace | `turbo run test` green (new `openspec/config.yaml` entry + `pnpm install`) |

## Threat Matrix

N/A — synchronous parse + pure rules + accumulator append; no routing/shell/subprocess/VCS/PR/process boundary.

## Migration / Rollback

No migration. `verdicts` optional; Fase A ignores it. Rollback: revert `runtime.ts` + `shared/AgentResult` to Fase A, delete `packages/evidence/`, drop `openspec/config.yaml` entry. Fase A continues unchanged.

## Open Questions

None blocking. `toolName` on each verdict lets Fase C correlate with `toolCalls[]` without positional order.
