# Tasks: Fase C — Strict Mode / Abstention (asymmetric v1)

Strict TDD is ACTIVE. Each impl task pairs a RED test with its GREEN impl. Asymmetric policy: only `incomplete` abstains; `stale`/`low_confidence` stay warnings. `RunAgentOptions.mode` default `'strict'`. Demo == live single classification path.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~600–700 (additions dominate; tests ≈ production) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | WU1 schema+policy → WU2 runtime override → WU3 route+ChatUI → WU4 verify+docs |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 — Schema+policy | `abstention.v1` contract + pure policy | PR 1 | `pnpm --filter @ftth-copilot/{shared,evidence} test` | `pnpm turbo run test typecheck --filter=@ftth-copilot/{shared,evidence}` | Revert contracts + delete new files. Fase B unaffected. |
| 2 — Runtime override | `mode` flag + override at both return paths | PR 2 | `pnpm --filter @ftth-copilot/agent-core test` | `pnpm turbo run test typecheck --filter=@ftth-copilot/agent-core` | Revert `runtime.ts`; flip `DEFAULT_TRUTH_GATE_MODE='observe'`. |
| 3 — Route+ChatUI | `__abstention__` persistence + warning bubble | PR 3 | `pnpm turbo run test typecheck --filter=@ftth-copilot/web` + `playwright test e2e/chat-abstention.spec.ts` | `pnpm turbo run test typecheck --filter=@ftth-copilot/web` | Revert `route.ts` + `ChatUI.tsx` + delete new tests. |
| 4 — Verify+docs | Workspace green + README | PR 4 | `pnpm turbo run test typecheck` | `pnpm turbo run test typecheck` | Revert `evidence/README.md` + delete spec. |

## Phase 1 — Schema + policy

- [x] **1.1** RED: valid `abstentionSchema` payload succeeds; mutations (wrong schema, empty `nextStep`, bad `reason`, non-array `missing`) fail; payload without `claim` accepted. GREEN: add `ABSTENTION_SCHEMA='ftth.abstention.v1' as const` + `abstentionSchema = z.object({...}).strict()` reusing `verdictCodeSchema`/`verdictSeveritySchema`. Extend `AgentResult` with `abstention?`+`abstained?`, `ChatResponse` with `abstention?` (type-only `import type`). Re-export `ABSTENTION_SCHEMA, abstentionSchema`. Files: `packages/shared/src/contracts.ts`, `packages/shared/src/index.ts`, `packages/shared/tests/contracts.test.ts`. Commit: `feat(shared): add ftth.abstention.v1 contract + additive AgentResult/ChatResponse fields`.

- [x] **1.2** Create `packages/evidence/src/abstention.ts` re-exporting `ABSTENTION_SCHEMA, abstentionSchema, Abstention` from `@ftth-copilot/shared`. Commit: `feat(evidence): re-export abstention contract from shared`.

- [x] **1.3** RED: policy table (strict+incomplete→abstain, strict+stale→warn, strict+low_confidence→warn, strict+ok→allow, observe+anything→allow); `buildAbstention` derivation (`[incomplete/get_onu_detail, ok/list_onus]`→`missing=['get_onu_detail']`, `available=['list_onus']`, `toolsAffected=['get_onu_detail']`; all-incompletes→`available=[]`); snapshot `nextStepFor('no-envelope',['get_onu_detail'])` byte-identical ×2 with voseo verb + tool reference. GREEN: `TruthGateMode`, `AbstentionDecision`, `shouldAbstain(verdicts, mode)`, `buildAbstention(verdicts, claim?)`, `nextStepFor(reason, toolsAffected)` (Argentine rioplatense voseo, deterministic). Re-export from index. Files: `packages/evidence/src/abstention-policy.ts`, `packages/evidence/src/index.ts`, `packages/evidence/tests/abstention-policy.test.ts`. Commit: `feat(evidence): asymmetric abstention policy + Spanish nextStep templates`.

## Phase 2 — runtime.ts

- [x] **2.1** RED→GREEN: add `mode?: 'strict'|'observe'` to `RunAgentOptions`, `export const DEFAULT_TRUTH_GATE_MODE: TruthGateMode = 'strict'`, resolve `const mode = opts.mode ?? DEFAULT_TRUTH_GATE_MODE`, import `shouldAbstain, buildAbstention`. Re-export from index. Existing `runtime.test.ts` stays green (default strict, no override yet). Files: `packages/agent-core/src/runtime.ts`, `packages/agent-core/src/index.ts`, `packages/agent-core/tests/runtime.test.ts`. Commit: `feat(agent-core): add TruthGate mode flag + default strict`.

- [x] **2.2** RED: 6 scenarios — strict+incomplete→`abstained:true`+template text; strict+stale-only→`abstained:undefined`+LLM text; strict+low_confidence-only→same; observe+incomplete→`abstained:undefined`+LLM text; observe+mixed→same; demo (`*.demo`) vs live (`*.poll`) producing same `incomplete`→both `abstained:true`. GREEN: add `formatAbstentionText(abstention)` helper (heading + `missing` bullets + `nextStep`); insert override block at BOTH return paths — when `mode==='strict' && shouldAbstain==='abstain'`, set `result.text`, `result.abstention`, `result.abstained=true`. Files: `packages/agent-core/src/runtime.ts`, `packages/agent-core/tests/runtime.test.ts`. Commit: `feat(agent-core): override LLM text in strict mode on incomplete verdicts`.

- [x] **2.3** RED→GREEN snapshot tests for `formatAbstentionText`: voseo verb present, tool reference present, byte-identical between invocations, both `nextStep` variants selected by dominant incomplete reason. Files: `packages/agent-core/tests/runtime.test.ts`. Commit: `test(agent-core): snapshot abstention bubble text + voseo invariants`.

## Phase 3 — Route + ChatUI

- [ ] **3.1** Scaffold vitest for `apps/web/`: `apps/web/vitest.config.ts` (node env); `vitest`+`@vitest/coverage-v8` in devDependencies; `pnpm install`. RED→GREEN in `apps/web/tests/api/chat-abstention.test.ts`: mock `prisma` + `getCurrentUser`/`hasPermission`/`resolveTenantConnector`/`consumeChatQuota`; mock `runAgent`→`{abstained:true, text:'…Re-colectá…', abstention:<Abstention>, toolCalls:[…], verdicts:[…]}`; `POST(new NextRequest(...))`; assert `prisma.message.create` called with `content===result.text` AND `toolCalls` contains `{name:'__abstention__', arguments:{}, result:<Abstention JSON>}`. GREEN in `route.ts`: read `process.env['TRUTH_GATE_MODE'] ?? 'strict'`, pass `mode` to `runAgent`; on `result.abstained` append `__abstention__` row to `toolCalls`; include `abstention` in `ChatResponse`. Files: `apps/web/vitest.config.ts`, `apps/web/package.json`, `apps/web/tests/api/chat-abstention.test.ts`, `apps/web/app/api/chat/route.ts`. Commit: `feat(web): persist ftth.abstention.v1 + __abstention__ row in strict mode`.

- [ ] **3.2** RED→GREEN in same suite: observe-mode case (mock `runAgent`→`{abstained:undefined, …}`). Assert `prisma.message.create` called WITHOUT a `__abstention__` row. Files: `apps/web/tests/api/chat-abstention.test.ts`. Commit: `test(web): observe mode does not persist __abstention__`.

- [ ] **3.3** RED→GREEN in `ChatUI.tsx`: extend `ChatMessage` with `abstention?`; read `data.abstention` from response. Add `<AbstentionBubble/>` (warning-tint, `missing` bullets, `nextStep` line); suppress `__abstention__` chip. Test in `apps/web/e2e/chat-abstention.spec.ts`: mock `/api/chat`→`{toolsUsed:[{name:'__abstention__', args:{}}, {name:'get_onu_detail', args:{}}]}`; assert bubble shows `missing`+`nextStep` and only `get_onu_detail` chip renders. Files: `apps/web/components/ChatUI.tsx`, `apps/web/e2e/chat-abstention.spec.ts`. Commit: `feat(web): abstention bubble in ChatUI + suppress __abstention__ chip`.

## Phase 4 — Workspace verify + docs

- [ ] **4.1** `pnpm turbo run test typecheck` workspace-wide green. Files: none. Commit: `chore(monorepo): verify turbo run test green with abstention`.

- [ ] **4.2** Update `packages/evidence/README.md`: Fase C section (`ABSTENTION_SCHEMA`, `shouldAbstain`/`buildAbstention`/`nextStepFor`, asymmetric policy table, rollback via `DEFAULT_TRUTH_GATE_MODE='observe'`). Files: `packages/evidence/README.md`. Commit: `docs(evidence): document strict-mode abstention API + rollback`.