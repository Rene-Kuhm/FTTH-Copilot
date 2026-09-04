# Tasks: Fase F — Permanent Evaluation + Injection Defense

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1365 (8 NEW in `packages/eval/`, 7 MODIFIED, 1 NEW nightly workflow, 1 NEW migration, 1 NEW CSV, 2 docs updates) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR F-1 → PR F-2 → PR F-3 → PR F-4 → PR F-5 → PR F-6 → PR F-7 → PR F-8 (stacked-to-main) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| F-1 | `verdict_log` schema + shared zod | PR F-1 | `pnpm --filter @ftth-copilot/shared test` | N/A (pure zod, no runtime) | revert `contracts.ts` + `schema.prisma` + migration |
| F-2 | `packages/eval` skeleton + pink/red corpus | PR F-2 | `pnpm --filter @ftth-copilot/eval test --passWithNoTests` | N/A (committable JSON, Node 22 `assert {type:'json'}`) | revert `packages/eval/` |
| F-3 | `finalize` consume-warn tier | PR F-3 | `pnpm --filter @ftth-copilot/agent-core test` | N/A (vitest) | revert `runtime.ts` finalize warn branch |
| F-4 | runner + assertions + metrics | PR F-4 | `pnpm --filter @ftth-copilot/eval test` | N/A (pure vitest, keyless) | revert `runner.ts` / `assertions.ts` / `metrics.ts` |
| F-5 | chat-route verdict_log writes | PR F-5 | `pnpm --filter @ftth-copilot/web test` | N/A (vitest, mocked Prisma) | revert `route.ts` write gate |
| F-6 | CI `eval` job + nightly workflow | PR F-6 | `pnpm exec actionlint .github/workflows/*.yml` | GitHub Actions (yaml lint via actionlint in PR) | revert `ci.yml` + delete `eval-nightly.yml` |
| F-7 | labels CSV + QA log link | PR F-7 | (no test) | N/A (manual NOC edit) | revert `agent-qa-log.md` + delete `.csv` |
| F-8 | workspace sweep + verify + archive | PR F-8 | `turbo run test typecheck` | N/A (CI aggregator) | revert docs README + roadmap + archived change |

## Phase F-1 — Schema + contracts (verdict_log) + shared zod

- [x] F-1.1 RED: add `verdict_log` Prisma model to schema with golden test
  - Description: GIVEN the new model is absent, WHEN `prisma generate` runs, THEN the test asserts `verdict_log` exists with `@@index([tenantId, observedAt])` per AD-6. GREEN: add model to `packages/db/prisma/schema.prisma`.
  - Files: `packages/db/prisma/schema.prisma`, `packages/db/tests/schema.test.ts` (NEW)
  - Tests: new `describe('verdict_log model')` asserting field set + index
  - Dependencies: none
  - Commit: `feat(db): add verdict_log model for Fase F eval/injection`
- [x] F-1.2 Add additive migration SQL mirroring Fase E pattern
  - Description: NEW `packages/db/prisma/migrations/<ts>_verdict_log/migration.sql`; `CREATE TABLE verdict_log` + `CREATE INDEX`; no destructive change.
  - Files: `packages/db/prisma/migrations/<ts>_verdict_log/migration.sql` (NEW)
  - Tests: `prisma migrate deploy` runs in CI integration job
  - Dependencies: F-1.1
  - Commit: `chore(db): add additive verdict_log migration`
- [x] F-1.3 RED: `verdictLogEntrySchema` zod + `VERDICT_LOG_SCHEMA` literal
  - Description: GIVEN an entry with `tenantId: ''` or `severity: 'unknown'`, WHEN `verdictLogEntrySchema.safeParse` runs, THEN `.success === false`. GREEN: add schema mirroring Prisma columns with `.strict()` and `VERDICT_LOG_SCHEMA = 'ftth.verdict-log.v1'`.
  - Files: `packages/shared/src/contracts.ts`, `packages/shared/tests/contracts.test.ts`
  - Tests: new `describe('ftth.verdict-log.v1')` block (~30 lines) covering empty tenantId + invalid severity rejection
  - Dependencies: none (parallelizable with F-1.1)
  - Commit: `feat(shared): add verdict-log v1 zod contract`
- [x] F-1.4 Re-export `VerdictLogEntry` from `@ftth-copilot/shared` index
  - Description: add `verdictLogEntrySchema`, `VERDICT_LOG_SCHEMA`, type `VerdictLogEntry` to `packages/shared/src/index.ts`; keep existing `index-exports.test.ts` golden passing.
  - Files: `packages/shared/src/index.ts`
  - Tests: existing `index-exports.test.ts` golden stays green; add new entry
  - Dependencies: F-1.3
  - Commit: `chore(shared): re-export verdictLogEntrySchema`

## Phase F-2 — eval package skeleton + corpus fixtures

- [x] F-2.1 Scaffold `packages/eval/{package.json, tsconfig.json, vitest.config.ts}` + README
  - Description: vitest workspace member; deps `@ftth-copilot/agent-core` + `@ftth-copilot/evidence`; vitest config with Node 22 JSON imports enabled (`resolveJsonModule`, `with {type:'json'}` test fixtures); README documents two-leg gate (keyless PR + keyed nightly).
  - Files: `packages/eval/{package.json, tsconfig.json, vitest.config.ts, README.md, src/index.ts}` (NEW)
  - Tests: `pnpm --filter @ftth-copilot/eval test` — `tests/skeleton.test.ts` proves barrel wiring
  - Dependencies: none
  - Commit: `chore(eval): scaffold @ftth-copilot/eval package with vitest+tsconfig+README`
- [x] F-2.2 `ftth.eval-corpus.v1` zod schema + golden tests
  - Description: `evalCaseSchema` (`.strict()`, 7 surfaces, 3 gates, optional 7 injectionKinds); `evalCorpusSchema` (literal schema + version + `cases.min(1)`); types `EvalCase`, `EvalCorpus`, `EvalSurface`, `InjectionKind`, `ExpectedGate`, `ToolMock` re-exported from the barrel.
  - Files: `packages/eval/src/corpus-schema.ts` (NEW), `packages/eval/src/index.ts` (MODIFIED), `packages/eval/tests/corpus-schema.test.ts` (NEW)
  - Tests: 19 schema cases (every enum value, missing field, strict-mode top-level key, min(1), round-trip)
  - Dependencies: F-2.1
  - Commit: `feat(eval): add corpus schema (ftth.eval-corpus.v1) + golden tests`
- [x] F-2.3 Author pink corpus JSON (≥1 per mapped surface, 7 surfaces minimum)
  - Description: benign traffic covering all 7 mapped surfaces; `expectedGate: 'allow'`. All device ids synthetic (`OLT-001-test`, `ONU-0001-test`).
  - Files: `packages/eval/corpus/pink.json` (NEW)
  - Tests: `corpus-fixtures.test.ts` asserts 7+ cases, every mapped surface present, schema parses, no real-data markers.
  - Dependencies: F-2.2
  - Commit: `feat(eval): add pink corpus covering 7 surfaces`
- [x] F-2.4 Author red corpus JSON (≥1 per injectionKind)
  - Description: red entries declaring `injectionKind` + `expectedGate` ∈ {warn, abstain}; covers all 7 injectionKinds. All device ids synthetic.
  - Files: `packages/eval/corpus/red.json` (NEW)
  - Tests: `corpus-fixtures.test.ts` asserts 7+ cases, 7+ distinct injectionKinds, every red case declares injectionKind + warn|abstain gate, schema parses.
  - Dependencies: F-2.2
  - Commit: `feat(eval): add pink + red attack corpus fixtures (>=7 cases each)`

## Phase F-3 — finalize consume-warn (runtime core)

- [x] F-3.1 RED: warn-tier byte-identity tests in `runtime.test.ts`
  - Description: GIVEN strict mode + verdicts `[stale]`, WHEN `finalize` runs, THEN `result.text === LLM_TEXT_LITERAL` via literal `toBe()` (NOT JSON round-trip), `result.warnings === ['stale']`, `result.abstained === undefined`, `result.abstention === undefined`, `buildAbstention` not called (vi.spyOn). Repeat for `[low_confidence]`.
  - Files: `packages/agent-core/tests/runtime.test.ts`
  - Tests: 3 new `it()` cases (warn preserves text; warn populates warnings; warn does not call `buildAbstention`)
  - Dependencies: F-3.2 (compile-only) — write first
  - Commit: `test(agent-core): add warn-tier byte-identity tests`
- [x] F-3.2 GREEN: add `'warn'` branch to `finalize` in `runtime.ts`
  - Description: when `shouldAbstain(...) === 'warn'`, return `{text, toolCalls, verdicts, warnings: <warn codes>}`; `'abstain'` and `'allow'` branches unchanged; warn codes are deduped distinct `VerdictCode` from `verdicts`.
  - Files: `packages/agent-core/src/runtime.ts`
  - Tests: F-3.1 turns green
  - Dependencies: F-3.1
  - Commit: `feat(agent-core): consume warn tier in finalize`
- [x] F-3.3 Re-export `VerdictCode` from `@ftth-copilot/agent-core` index
  - Description: ensure `VerdictCode` is exported from `packages/agent-core/src/index.ts` (it currently is — verify and pin via test).
  - Files: `packages/agent-core/src/index.ts`
  - Tests: existing `index-exports.test.ts` golden stays green
  - Dependencies: F-3.2
  - Commit: `chore(agent-core): pin VerdictCode re-export`

## Phase F-4 — runner + assertions + metrics

- [ ] F-4.1 RED: corpus-loader test (zod rejection + stable-ID dedup); GREEN: implement
  - Description: GIVEN an entry missing `surface` or two entries sharing `id`, WHEN `loadCorpus()` runs, THEN reject the entry / dedupe. GREEN: implement `corpus-loader.ts` reading JSON with Node 22 `assert {type:'json'}` + zod validate + dedup.
  - Files: `packages/eval/src/corpus-loader.ts` (NEW), `packages/eval/tests/corpus-loader.test.ts` (NEW)
  - Tests: 2 cases (schema rejection; stable-ID dedup)
  - Dependencies: F-2.3, F-2.4
  - Commit: `feat(eval): add zod-validated corpus loader`
- [ ] F-4.2 RED: runner test (keyless execution, same seam); GREEN: implement
  - Description: GIVEN a corpus case, WHEN runner executes, THEN no `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `MINIMAX_API_KEY` is read and `AgentResult` shape matches unit tests. GREEN: `runner.ts` reuses `vi.mock('../src/llm')` + `withToolResults` from `runtime.test.ts`.
  - Files: `packages/eval/src/runner.ts` (NEW), `packages/eval/tests/runner.test.ts` (NEW)
  - Tests: 2 cases (keyless; same seam shape)
  - Dependencies: F-4.1
  - Commit: `feat(eval): add mocked-keyless corpus runner`
- [ ] F-4.3 RED: assertions test (per-gate + pink observability-only); GREEN: implement
  - Description: GIVEN a red case, WHEN assertion runs, THEN gate fires iff `refuse`/`abstain`/`warn-flag` rule holds. GIVEN pink, gate NEVER fires. GREEN: `assertions.ts` with surface coverage report.
  - Files: `packages/eval/src/assertions.ts` (NEW), `packages/eval/tests/assertions.test.ts` (NEW)
  - Tests: 4 cases (refuse/abstain/warn-flag/pink); 1 surface coverage gap case
  - Dependencies: F-4.2
  - Commit: `feat(eval): add gate assertions + coverage report`
- [ ] F-4.4 RED: metrics test (coverage / abstention / FP / TBD precision); GREEN: implement
  - Description: GIVEN fixture rows for a tenant, WHEN metrics run, THEN `coverage = 0.6`, `abstention_rate = 0.07`, FP reported as `TBD` without fail. GREEN: `metrics.ts` builds nightly report from `ConfirmedIncident` + `verdict_log` shapes.
  - Files: `packages/eval/src/metrics.ts` (NEW), `packages/eval/tests/metrics.test.ts` (NEW)
  - Tests: 4 cases (coverage, abstention, FP, TBD precision)
  - Dependencies: F-4.3
  - Commit: `feat(eval): add nightly metric builder`

## Phase F-5 — verdict_log writer + chat-route integration

- [ ] F-5.1 RED: verdict-log-writer test (per-verdict row, fail-safe skip); GREEN: implement
  - Description: GIVEN red-case verdicts, WHEN writer runs, THEN one `VerdictLogEntry` row per verdict emitted; on Prisma error, log + skip (never throw). GREEN: `verdict-log-writer.ts` builds entries from verdict set.
  - Files: `packages/eval/src/verdict-log-writer.ts` (NEW), `packages/eval/tests/verdict-log-writer.test.ts` (NEW)
  - Tests: 2 cases (per-verdict row; fail-safe on error)
  - Dependencies: F-1.3, F-4.3
  - Commit: `feat(eval): add verdict-log writer`
- [ ] F-5.2 Extend `apps/web/app/api/chat/route.ts` with verdict_log + warn AgentActionLog writes
  - Description: after `Message.create`, write `AgentActionLog { toolName: '__injection_suspicion__' }` when `result.warnings` non-empty + one `verdict_log` row per verdict. Wrap in fail-safe try/catch (log + skip) so chat never breaks. Add `warnings?: VerdictCode[]` to `AgentResult`/`ChatResponse` types in `packages/shared/src/index.ts`.
  - Files: `apps/web/app/api/chat/route.ts`, `packages/shared/src/index.ts`
  - Tests: F-5.3 chat-abstention test asserts persistence + byte-identity
  - Dependencies: F-3.2, F-1.4
  - Commit: `feat(web): persist verdict_log rows on chat completion`
- [ ] F-5.3 RED: `__injection_suspicion__` row + `verdict_log` assertions; GREEN: extend mock chain
  - Description: extend `apps/web/tests/api/chat-abstention.test.ts` mocks for `prisma.verdictLog.create`; assert exactly one `AgentActionLog` row with `toolName === '__injection_suspicion__'` + N `verdict_log` rows; `Message.content` byte-identical to LLM text (no wrapper).
  - Files: `apps/web/tests/api/chat-abstention.test.ts`
  - Tests: 2 new cases (warn → 1 suspicion row + N verdict rows; byte-identity of Message.content)
  - Dependencies: F-5.2
  - Commit: `test(web): assert injection_suspicion log rows`

## Phase F-6 — CI workflow + nightly

- [ ] F-6.1 Add `eval` job to `.github/workflows/ci.yml` after `test-unit`
  - Description: `needs: [lint-and-typecheck, test-unit]`, `if: always()`, no `secrets.*` in `env`, runs `pnpm --filter @ftth-copilot/eval test`; non-zero on `attack-pass-rate < 1.0` or surface coverage gap.
  - Files: `.github/workflows/ci.yml`
  - Tests: workflow yaml lint via `actionlint` (manual in PR)
  - Dependencies: F-4.4
  - Commit: `ci(eval): add keyless attack-pass-rate gate`
- [ ] F-6.2 Append `eval` to `ci-success` aggregator
  - Description: add `eval` to the `needs:` list of `ci-success`; keep existing jobs unchanged.
  - Files: `.github/workflows/ci.yml`
  - Tests: existing ci-success aggregator check stays consistent
  - Dependencies: F-6.1
  - Commit: `ci: add eval job to ci-success aggregator`
- [ ] F-6.3 Create `.github/workflows/eval-nightly.yml`
  - Description: NEW file. `schedule:` cron + `workflow_dispatch`; uses `MINIMAX_API_KEY` secret; runs `packages/eval` nightly against full corpus + `ConfirmedIncident` corpus; NEVER fails job (observational only).
  - Files: `.github/workflows/eval-nightly.yml` (NEW)
  - Tests: workflow yaml lint; secret presence verified in repository settings
  - Dependencies: F-4.4
  - Commit: `ci(eval): add nightly MiniMax-M3 metrics workflow`

## Phase F-7 — labels CSV + corpus seed

- [ ] F-7.1 Add `docs/validation/agent-qa-log.labels.csv`
  - Description: NEW. Per-Q columns `id, expected_gate, label, notes`; NOC tech lead edits CSV; prose untouched.
  - Files: `docs/validation/agent-qa-log.labels.csv` (NEW)
  - Tests: N/A (manual)
  - Dependencies: none
  - Commit: `docs(validation): seed precision labels CSV`
- [ ] F-7.2 Update `docs/validation/agent-qa-log.md` to reference labels CSV
  - Description: add a 1-paragraph note linking to `agent-qa-log.labels.csv`; precision `TBD` until NOC labels exist.
  - Files: `docs/validation/agent-qa-log.md`
  - Tests: N/A
  - Dependencies: F-7.1
  - Commit: `docs(validation): link labels CSV from QA log`
- [ ] F-7.3 Assert `precision === 'TBD'` in metrics tests
  - Description: RED test in `packages/eval/tests/metrics.test.ts`: when no labels CSV, `precision` reports `"TBD"`. GREEN: metrics.ts TBD branch.
  - Files: `packages/eval/tests/metrics.test.ts`
  - Tests: 1 case asserting TBD marker
  - Dependencies: F-7.1
  - Commit: `test(eval): assert precision TBD marker`

## Phase F-8 — workspace regression sweep + verify

- [ ] F-8.1 Update `packages/evidence/README.md` with Fase F section
  - Description: brief note on `warn`-tier wiring + `verdict_log` reference.
  - Files: `packages/evidence/README.md`
  - Tests: N/A
  - Dependencies: F-3.2, F-1.3
  - Commit: `docs(evidence): document Fase F warn tier + verdict_log`
- [ ] F-8.2 Add Fase F entry to `docs/evidence-first-roadmap.md`
  - Description: short bullet summarizing two-leg gate; link `packages/eval`.
  - Files: `docs/evidence-first-roadmap.md`
  - Tests: N/A
  - Dependencies: F-8.1
  - Commit: `docs(roadmap): record Fase F eval milestone`
- [ ] F-8.3 Workspace-wide regression sweep
  - Description: `turbo run test typecheck` from repo root; iterate fixes for any breakage; collect results.
  - Files: (no source changes expected; iterate if breakage)
  - Tests: full `turbo run test` PASS
  - Dependencies: F-1..F-7 complete
  - Commit: (no commit unless fixes required)
- [ ] F-8.4 Generate verify-report + archive + spec promotion
  - Description: sdd-verify produces `verify-report.md`; sdd-archive moves `openspec/changes/fase-f-eval-injection/` to `openspec/changes/archive/2026-09-03-fase-f-eval-injection/` and merges deltas into `openspec/specs/{strict-mode-abstention,evidence-provenance,confirmed-incident-memory,eval-harness,injection-defense,eval-metrics}/spec.md`.
  - Files: `openspec/changes/fase-f-eval-injection/verify-report.md` (NEW), archived folder
  - Tests: archive entry exists; main specs contain merged ADDED Requirements
  - Dependencies: F-8.3 PASS
  - Commit: `chore(sdd): archive fase-f-eval-injection with verify-report`
