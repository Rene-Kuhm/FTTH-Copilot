# Design: Fase C — Strict Mode Abstention

## Technical Approach

Promote the Fase B observe-mode Truth Gate to asymmetric enforcement. `runAgent` becomes mode-aware: `strict` (default) replaces the LLM's text with an `abstention.v1` payload when any verdict is `incomplete`; `observe` keeps Fase B unchanged. Classification is untouched (single path; demo = live parity). All additions are additive optional fields + a synthetic pseudo-tool row; no Prisma migration.

## Architecture Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Policy location | Pure functions in `packages/evidence/src/abstention-policy.ts`, no source-branching | Single classification path preserved; trivially testable. |
| 2 | Default `mode` | `'strict'`, exported as `DEFAULT_TRUTH_GATE_MODE` constant | Reviewable + importable; matches spec. |
| 3 | Override site | Inline blocks at BOTH return paths (`runtime.ts` ~L107 + ~L125-129) | Matches existing return shape; helper duplicates branch logic. |
| 4 | `Abstention` location | zod schema in `packages/shared/src/contracts.ts`; type re-exported from `packages/evidence/src/abstention.ts` | Persisted JSON lives in `Message.toolCalls` (DB). |
| 5 | Shared → Evidence cycle | Type-only `import type` + `peerDependenciesMeta.optional=true` | Exact Fase B pattern for `Verdict`. |
| 6 | Persistence | `{name: '__abstention__', arguments: {}, result: <Abstention>}` appended to `Message.toolCalls` JSON | No Prisma migration; `toolCalls` already stores audit trail. |
| 7 | Rendering | New warning-tint abstention bubble keyed on `__abstention__` row OR `response.abstention` | Operators must see what was missing. |
| 8 | nextStep | Pure `nextStepFor(reason, toolsAffected)` keyed on dominant `incomplete.reason` | Determinism + snapshots; matches `prompts/system.ts` voseo. |

## Data Flow

```
  /api/chat ──mode──▶ runAgent: loop llm → executeToolCall → classifyToolResult
                  return paths (L107, L125-129):
                    strict + any incomplete → buildAbstention → formatAbstentionText → result.text/abstention/abstained
                    observe OR no incomplete → result.text (Fase B)
                       ▼
  /api/chat route: if abstained → content = text, toolCalls += __abstention__ row,
                                 ChatResponse.abstention = payload
                       ▼
  ChatUI: abstention → warning bubble (missing + nextStep bullets);
          __abstention__ row suppressed from tool chip list
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/evidence/src/abstention.ts` | Create | zod `abstentionSchema`, `Abstention`, `ABSTENTION_SCHEMA` |
| `packages/evidence/src/abstention-policy.ts` | Create | `shouldAbstain`, `buildAbstention`, `nextStepFor` (pure) |
| `packages/evidence/src/index.ts` | Modify | Re-export new symbols |
| `packages/evidence/tests/abstention-policy.test.ts` | Create | Policy + derivation + snapshot tests |
| `packages/shared/src/contracts.ts` | Modify | Add `ABSTENTION_SCHEMA`, `abstentionSchema`, `Abstention` |
| `packages/shared/src/index.ts` | Modify | `abstention?`+`abstained?` on `AgentResult`; `abstention?` on `ChatResponse`; re-export |
| `packages/agent-core/src/runtime.ts` | Modify | `mode?` + `DEFAULT_TRUTH_GATE_MODE`; override at L107 + L125-129; `formatAbstentionText` (snapshot-tested) |
| `packages/agent-core/src/index.ts` | Modify | Re-export `DEFAULT_TRUTH_GATE_MODE` |
| `packages/agent-core/tests/runtime.test.ts` | Modify | Observe regression + 5 strict scenarios + demo = live parity |
| `apps/web/app/api/chat/route.ts` | Modify | Pass `mode: process.env['TRUTH_GATE_MODE'] ?? 'strict'`; on `abstained` persist text + `__abstention__` row; attach `abstention` |
| `apps/web/tests/api/chat-abstention.test.ts` | Create | Strict persists `__abstention__` + Spanish content; observe persists neither |
| `apps/web/components/ChatUI.tsx` | Modify | Response type gains `abstention?`; new warning bubble; suppress `__abstention__` from chip list |

## Interfaces / Contracts

```ts
// packages/shared/src/contracts.ts
export const ABSTENTION_SCHEMA = 'ftth.abstention.v1' as const;
export const abstentionSchema = z.object({
  schema: z.literal(ABSTENTION_SCHEMA),
  reason: verdictCodeSchema,                    // 'incomplete'
  severity: verdictSeveritySchema,              // 'warning' | 'critical'
  claim: z.string().min(1).optional(),
  missing: z.array(z.string().min(1)),
  available: z.array(z.string().min(1)),
  nextStep: z.string().min(1),
  toolsAffected: z.array(z.string().min(1)).min(1),
}).strict();
export type Abstention = z.infer<typeof abstentionSchema>;

// packages/evidence/src/abstention-policy.ts (pure)
export type AbstentionDecision = 'allow' | 'warn' | 'abstain';
export type TruthGateMode = 'observe' | 'strict';
export function shouldAbstain(verdicts: Verdict[], mode: TruthGateMode): AbstentionDecision;
export function buildAbstention(verdicts: Verdict[], claim?: string): Abstention;
export function nextStepFor(reason: string, toolsAffected: string[]): string;

// packages/shared/src/index.ts (additive, type-only import)
import type { Abstention } from './contracts';
export interface AgentResult { /* existing fields */; abstention?: Abstention; abstained?: boolean; }
export interface ChatResponse { /* existing fields */; abstention?: Abstention; }
```

Spanish `nextStep` templates (Argentine rioplatense voseo, matching `prompts/system.ts:1-52`):

- **Template A** (`no-envelope` / `parse-error`): `"Re-colectá las métricas de ${toolsAffected.join(', ')} y volvé a consultar."`
- **Template B** (`partial-completeness` / `minimal-completeness`): `"Verificá el identificador de la ONU y solicitá un reintento del NMS."`

Selection: dominant `incomplete.reason` from highest-severity incomplete; fallback to Template A.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `shouldAbstain` table | `(incomplete,strict)→abstain`, `(stale,strict)→warn`, `(low_confidence,strict)→warn`, `(ok,strict)→allow`; `(any,observe)→allow` |
| Unit | `buildAbstention` derivation | Mixed `[incomplete/get_onu_detail, ok/list_onus]` → `missing=['get_onu_detail']`, `available=['list_onus']`, `toolsAffected=['get_onu_detail']`; all-incompletes → `available=[]` |
| Snapshot | Spanish templates | Byte-identical across invocations + voseo verb + tool reference |
| Contract | `abstentionSchema` | Mutate `schema`, empty `nextStep`, bad `reason`, non-array `missing` → `.success === false`; payload without `claim` accepted |
| Runtime | strict/observe matrix | 6 scenarios from spec; Fase B regression in observe; inject `parse-error` + `partial-completeness` via `executeToolCall` mock |
| Persistence | Route | Strict → `Message.content === result.text` AND `toolCalls` contains `__abstention__`; observe → no `__abstention__` row |
| UI | ChatUI bubble | Render: abstention renders warning bubble; `__abstention__` row does NOT render as tool chip |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary touched.

## Migration / Rollout

No migration; all additions optional. Rollback: flip `DEFAULT_TRUTH_GATE_MODE` to `'observe'` and remove the override blocks at L107 + L125-129. `TRUTH_GATE_MODE` env var on the route accepts `'observe'` for per-deployment rollback without rebuild.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Over-blocking legitimate responses | Med | Only `incomplete` abstains; `observe` reachable for calibration |
| Persistence drift content vs `toolCalls` | Low | `toolCalls[__abstention__]` is source of truth; `content` is rendered text |
| Client breaks on new `abstention` field | Low | All additions optional |
| Robotic `nextStep` UX | Low | Short Spanish templates + snapshot tests |

## Open Questions

None — all scope locked by proposal + specs.