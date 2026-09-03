# Tasks: Fase B — Truth Gate (observation mode)

Strict TDD is ACTIVE. Each implementation task below is a RED→GREEN pair.
TruthGate thresholds: confidence ≥ 0.3 inclusive (strict `<` for low); staleness
strict `now > observedAt + ttlMs` (equality is fresh); severity ranking
`incomplete(3) > stale(2) > low_confidence(1) > ok(0)`; demo == live single path.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~280–350 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | TruthGate package + runAgent wiring + shared types | PR 1 | `pnpm --filter @ftth-copilot/evidence test && pnpm --filter @ftth-copilot/agent-core test` | `pnpm turbo run test typecheck` workspace | Delete `packages/evidence/`; revert `packages/agent-core/src/runtime.ts` + `packages/shared/src/index.ts` + `packages/agent-core/package.json` dep + `openspec/config.yaml` entry. Fase A unaffected. |

## Phase 1 — Package skeleton

- [x] **1.1** Scaffold `packages/evidence/` mirroring `packages/security/`.
      - **What**: Create `package.json` (name `@ftth-copilot/evidence`, runtime dep `zod` via `@ftth-copilot/shared`, workspace dep on `@ftth-copilot/shared`), `tsconfig.json` (strict ES2022), `vitest.config.ts`, and `src/index.ts` stub. Acceptance: `pnpm --filter @ftth-copilot/evidence test` runs green; `tsc --noEmit` passes; workspace resolves.
      - **Files**: `packages/evidence/package.json`, `packages/evidence/tsconfig.json`, `packages/evidence/vitest.config.ts`, `packages/evidence/src/index.ts`.
      - **Tests**: vitest discovers empty suite (--passWithNoTests); typecheck exit 0.
      - **Depends on**: none.
      - **Commit**: `chore(evidence): scaffold @ftth-copilot/evidence package`.

## Phase 2 — TruthGate classifier (strict TDD, RED→GREEN per task)

- [x] **2.1** RED: `packages/evidence/tests/truth-gate.test.ts` — assert `classifyUnwrapped('list_olts')` returns `{ toolName:'list_olts', code:'incomplete', reason:'no-envelope', severity:'critical' }` (parameterised over name). GREEN: implement `classifyUnwrapped(toolName)` in `packages/evidence/src/truth-gate.ts` returning that fixed verdict.
      - **Files**: `packages/evidence/src/truth-gate.ts`, `packages/evidence/tests/truth-gate.test.ts`.
      - **Commit**: `feat(evidence): classifyUnwrapped returns no-envelope incomplete verdict`.

- [x] **2.2** RED: confidence cases — missing field → `{ code:'low_confidence', reason:'missing-confidence', severity:'warning' }`; `confidence: 0.2` → `low_confidence / low-confidence-value`; `confidence: 0.3` → ok at threshold (inclusive); `confidence: 1.0` → ok. GREEN: private `classifyConfidence()` helper that pushes confidence-side candidate verdicts using safeParse of `evidenceProvenanceSchema`.
      - **Files**: `packages/evidence/src/truth-gate.ts`, `packages/evidence/tests/truth-gate.test.ts`.
      - **Commit**: `feat(evidence): confidence classification with fixed 0.3 threshold`.

- [x] **2.3** RED: staleness — 5 min old + `ttlMs:900000` + `now=observedAt+5min` → not stale; 20 min old + `ttlMs:900000` → `{ code:'stale', reason:'expired-ttl', severity:'warning' }`; `now === observedAt + ttlMs` (edge) → not stale. GREEN: implement `now > observedAt + ttlMs` strict comparison using injected `now?: Date`.
      - **Files**: `packages/evidence/src/truth-gate.ts`, `packages/evidence/tests/truth-gate.test.ts`.
      - **Commit**: `feat(evidence): staleness classification with strict greater-than`.

- [x] **2.4** RED: completeness — `completeness:'complete'` → ok; `'partial'` → `{ code:'incomplete', reason:'partial-completeness', severity:'warning' }`; `'minimal'` → `{ code:'incomplete', reason:'minimal-completeness', severity:'critical' }`. GREEN: implement `classifyCompleteness()` private helper with the fixed map.
      - **Files**: `packages/evidence/src/truth-gate.ts`, `packages/evidence/tests/truth-gate.test.ts`.
      - **Commit**: `feat(evidence): completeness classification with fixed map`.

- [x] **2.5** RED: ranker + aggregation + demo == live — `stale + minimal` → `incomplete`; `low_confidence + stale` → `stale`; all three non-ok → `incomplete`; all-ok → `{ code:'ok', reason:'fresh-complete', severity:'ok' }`; identical demo (`source:'x.demo'`) vs live (`source:'x.poll'`) envelopes → byte-identical verdict. GREEN: implement `classifyEnvelope(parsed, toolName, now?)` running safeParse, collecting candidates, ranking by severity desc; export `VerdictCode / VerdictSeverity / Verdict` from a new `packages/evidence/src/types.ts`; `packages/evidence/src/index.ts` re-exports `classifyEnvelope, classifyUnwrapped, Verdict*`.
      - **Files**: `packages/evidence/src/truth-gate.ts`, `packages/evidence/src/types.ts`, `packages/evidence/src/index.ts`, `packages/evidence/tests/truth-gate.test.ts`.
      - **Commit**: `feat(evidence): envelope classifier with severity-ranked aggregation`.

## Phase 3 — Shared AgentResult contract

- [x] **3.1** RED: in `packages/shared/tests/contracts.test.ts` (new) assert a literal `{ text:'t', toolCalls:[] }` still type-checks (no new required fields). GREEN: in `packages/shared/src/index.ts` add `import type { Verdict } from '@ftth-copilot/evidence'` and extend `AgentResult` with optional `verdicts?: Verdict[]`; add `@ftth-copilot/evidence: workspace:*` to `devDependencies` of `packages/shared/package.json` (type-only resolution).
      - **Files**: `packages/shared/src/index.ts`, `packages/shared/package.json`, `packages/shared/tests/contracts.test.ts`.
      - **Depends on**: 2.5.
      - **Commit**: `feat(shared): add optional verdicts field to AgentResult`.
      - **Note**: shared declares @ftth-copilot/evidence as `peerDependencies` + `peerDependenciesMeta.optional: true` instead of `devDependencies`. devDependencies created a workspace cycle that pnpm/turbo reject as fatal. The design's intent (type-only resolution, "shared stays free of runtime cross-package wiring") is preserved.

## Phase 4 — runAgent wiring (strict TDD)

- [x] **4.1** RED: `packages/agent-core/tests/runtime.test.ts` — drive 3 sequential tool calls (mock LLM); assert `result.verdicts?.length === 3` AND every entry has a string `toolName`. GREEN: in `packages/agent-core/src/runtime.ts` add module-scope `verdicts: Verdict[] = []`, `const now = new Date()`, and `classifyToolResult(raw, toolName)` helper (try `JSON.parse`, catch → `incomplete / parse-error / critical`; non-object → `classifyUnwrapped`; else `classifyEnvelope(parsed, toolName, now)`); push into `verdicts` after each `executeToolCall`; include `verdicts` in both return literals. Re-export `Verdict, classifyEnvelope, classifyUnwrapped` from `packages/agent-core/src/index.ts`.
      - **Files**: `packages/agent-core/src/runtime.ts`, `packages/agent-core/src/index.ts`, `packages/agent-core/tests/runtime.test.ts`.
      - **Depends on**: 3.1.
      - **Commit**: `feat(agent-core): wire TruthGate accumulator into runAgent`.

- [x] **4.2** RED: same suite — (a) when `executeToolCall` returns plain text (non-JSON), `verdicts[i]` is `{ code:'incomplete', reason:'parse-error', severity:'critical' }`; (b) `createMessage.mock.calls[*][*].messages` still contains the original raw `result` string verbatim (observe mode). GREEN: confirm `JSON.parse` throw path produces `parse-error` (distinct from `no-envelope`); confirm the `[tool_result for ${name}] ${result}` line is unchanged. Add a second test asserting a stale `result` string appears verbatim in the next LLM message payload.
      - **Files**: `packages/agent-core/src/runtime.ts`, `packages/agent-core/tests/runtime.test.ts`.
      - **Depends on**: 4.1.
      - **Commit**: `test(agent-core): prove observe-mode preserves LLM payload under failure`.

## Phase 5 — Turbo + openspec wiring

- [x] **5.1** Add `@ftth-copilot/evidence: workspace:*` to `dependencies` of `packages/agent-core/package.json`. In `openspec/config.yaml`, append a new project entry mirroring the `packages/security` block but pointing at `packages/evidence` (`test: vitest run --passWithNoTests`, `typecheck: tsc --noEmit`, `lint`, `coverage`). Run `pnpm install` to resolve symlink.
      - **Files**: `packages/agent-core/package.json`, `openspec/config.yaml`.
      - **Depends on**: 1.1, 4.2.
      - **Commit**: `chore(monorepo): register @ftth-copilot/evidence in workspace and openspec`.

- [x] **5.2** Workspace verification: `pnpm turbo run test typecheck --filter=@ftth-copilot/evidence` then `pnpm turbo run test typecheck` workspace-wide must be green. Fix any resolution failures. No file changes expected.
      - **Files**: none (verification only).
      - **Depends on**: 5.1.
      - **Commit**: `chore(monorepo): verify turbo run test green with evidence package`.

## Phase 6 — Documentation

- [x] **6.1** Author `packages/evidence/README.md`: public API (`classifyEnvelope`, `classifyUnwrapped`, `Verdict`), the thresholds (confidence ≥ 0.3 inclusive, strict `>` for staleness, completeness map), severity ranking, observe-mode invariant (LLM payload unchanged), demo == live note. Add JSDoc to `classifyEnvelope` / `classifyUnwrapped` exports.
      - **Files**: `packages/evidence/README.md`, `packages/evidence/src/truth-gate.ts`.
      - **Depends on**: 5.2.
      - **Commit**: `docs(evidence): document TruthGate API and observe-mode invariants`.

---

## Review Workload Forecast (detailed)

| Field | Value |
|-------|-------|
| Estimated changed lines | ~280–350 (new package ~120, evidence tests ~120, runtime wiring ~30, runtime tests ~40, shared types ~5, configs ~20, docs ~30) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

**Reasoning**: new package is small and self-contained; runtime wiring adds ~30 lines to one file; shared type is additive (`verdicts?` optional, no existing field touched). Strict TDD doubles the visible diff ratio in evidence tests vs production, but the cumulative change stays well under the 400-line review budget. A single PR keeps the gate-introducing change atomic; rollback is a clean revert of `runtime.ts` + `shared/index.ts` + `agent-core/package.json` dep + the `openspec/config.yaml` entry plus one deletion (`packages/evidence/`), with Fase A continuing to function unchanged.
