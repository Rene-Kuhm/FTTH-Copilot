# Proposal: Fase C — Strict Mode / Abstention (asymmetric v1)

## Intent

Flip the Truth Gate from observation (Fase B) to enforcement. When evidence is **incomplete**, replace the LLM's text with a structured `abstention.v1` payload so the agent never fabricates from missing or non-parseable data. `stale` / `low_confidence` stay warnings — calibration signal is preserved (roadmap §7.1: a too-strict gate is as harmful as none).

## Scope

### In Scope
- `ftth.abstention.v1` zod contract + types in `packages/shared` (additive)
- `packages/evidence/src/abstention.ts` + `abstention-policy.ts` (`shouldAbstain`, `buildAbstention`)
- `runAgent` post-LLM override gated on `mode: 'strict'` + any `verdict.code === 'incomplete'` (both return paths)
- Additive `AgentResult.abstention?` + `abstained?`, `ChatResponse.abstention?`
- Spanish `nextStep` template (code-emitted, no LLM in loop)
- Route persists into `Message.content` + synthetic `__abstention__` row in `Message.toolCalls` (no Prisma migration); passes `mode`
- ChatUI: distinct abstention bubble, warning tint, `missing` + `nextStep` bullets
- `RunAgentOptions.mode` default `'strict'`; `mode: 'observe'` reachable for calibration
- Tests for asymmetric policy + override behavior

### Out of Scope
- Per-tenant policy (Fase E), telemetry sink (Fase F), Fase B threshold re-tuning
- Multi-turn history tagging, prompt-side directive, Prisma migration
- Demo/live branching (single classification path preserved)

## Capabilities

### New Capabilities
- `strict-mode-abstention`: contract, policy, runAgent override, route persistence, UI bubble

### Modified Capabilities
- `truth-gate-classification`: "Observe Mode in runAgent" branches on `mode` — `strict` triggers override on `incomplete`; `observe` unchanged

## Approach

Fixed policy map:

| Verdict | Strict | Observe |
|---------|--------|---------|
| `incomplete` | **abstain** (override) | warn, allow |
| `stale` | warn, allow | warn, allow |
| `low_confidence` | warn, allow | warn, allow |
| `ok` | allow | allow |

Override is **post-LLM**. `runAgent` synthesizes `Abstention`, replaces `result.text` with the Spanish template, attaches `result.abstention`. `verdicts` array remains the audit trail.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/shared/src/contracts.ts` | Modified | `ABSTENTION_SCHEMA`, `abstentionSchema`, `Abstention` |
| `packages/shared/src/index.ts` | Modified | Re-export + additive fields on `AgentResult`, `ChatResponse` |
| `packages/evidence/src/abstention.ts` | New | zod schema, types |
| `packages/evidence/src/abstention-policy.ts` | New | `shouldAbstain`, `buildAbstention` |
| `packages/evidence/src/index.ts` | Modified | Re-export |
| `packages/evidence/tests/abstention-policy.test.ts` | New | Asymmetric policy coverage |
| `packages/agent-core/src/runtime.ts` | Modified | `mode` in `RunAgentOptions`; override at both return paths |
| `packages/agent-core/src/index.ts` | Modified | Re-export |
| `apps/web/app/api/chat/route.ts` | Modified | Persist `abstention`; pass `mode` |
| `apps/web/components/ChatUI.tsx` | Modified | Distinct abstention bubble |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Over-blocking legitimate responses | Med | Only `incomplete` abstains; `observe` reachable for calibration |
| Persistence drift content vs `toolCalls` | Low | `toolCalls[__abstention__]` is source of truth; `content` is rendered text |
| Client breaks on new `abstention` | Low | All additions optional |
| Robotic `nextStep` UX | Low | Short Spanish templates, snapshot tests |

## Rollback Plan

Flip `RunAgentOptions.mode` default to `'observe'` and remove the override call site in `runtime.ts` (one line). No Prisma migration; `abstention` stays optional; pre-Fase-C consumers unaffected.

## Dependencies

- Fase B `packages/evidence` (TruthGate, `Verdict`, severity ordering) — shipped
- Fase A `evidence.provenance.v1` envelope — same classification path

## Success Criteria

- [ ] `strict` + any `incomplete` → `abstention` populated, `abstained === true`, `result.text` matches template
- [ ] `strict` + only `stale`/`low_confidence`/`ok` → `abstained === false`, `abstention === undefined`, LLM text unchanged
- [ ] `observe` → `abstention` never populated regardless of verdicts
- [ ] ChatUI renders distinct bubble iff `abstention` present
- [ ] Route persists Spanish text into `Message.content`; JSON into `Message.toolCalls[__abstention__]`; existing messages load unchanged
- [ ] `turbo run test` green; asymmetric policy covered
