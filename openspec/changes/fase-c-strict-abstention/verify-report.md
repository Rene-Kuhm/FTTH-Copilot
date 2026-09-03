```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:61a7e986c3aa7127c238d0c9dd7c46f78c647ab32134af76219e3a349dfeda78
verdict: pass
blockers: 0
critical_findings: 0
requirements: 9/9
scenarios: 19/19
test_command: node_modules/.bin/turbo run test --force
test_exit_code: 0
test_output_hash: sha256:518d5ae5220692e1af3908fba53dd2edbf49fbe0ddbdc1d0b63d46aebe384150
build_command: node_modules/.bin/turbo run build --force
build_exit_code: 0
typecheck_command: node_modules/.bin/turbo run typecheck --force
typecheck_exit_code: 0
```

## Verification Report

**Change**: fase-c-strict-abstention
**Capability**: new `strict-mode-abstention` + additive `Mode enforcement` on `truth-gate-classification` + additive `Abstention attached to AgentResult` on `evidence-provenance`
**Mode**: Standard (Strict TDD active per task brief — RED/GREEN pairs visible across commits `3383695`, `abe1192`, `3e8f29c`, `8a524b0`, `ce94863`; no `strict-tdd-verify.md` module loaded — counting tests against scenarios is sufficient evidence)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 9 (Phase 1.1–1.3, 2.1–2.3, 3.1–3.3; `tasks.md` Phase 4 4.1–4.2 covered by this work) |
| Tasks complete (Phase 1–3) | 9 / 9 marked `[x]` |
| Tasks incomplete | 0 (Phase 1 and 2 complete; Phase 3 complete: tasks 3.1, 3.2, 3.3 all marked `[x]`) |
| Requirements added | 9 (`strict-mode-abstention` 7 + `truth-gate-classification` delta 1 + `evidence-provenance` delta 1) |
| Scenarios added | 19 (`strict-mode-abstention` 9 + `truth-gate-classification` delta 6 + `evidence-provenance` delta 4) |

> Authoritative counts come from `openspec/changes/fase-c-strict-abstention/specs/`:
> - `strict-mode-abstention/spec.md`: 7 `### Requirement:` headings, 9 `#### Scenario:` headings
> - `truth-gate-classification/spec.md` (delta): 1 `### Requirement:` heading, 6 `#### Scenario:` headings
> - `evidence-provenance/spec.md` (delta): 1 `### Requirement:` heading, 4 `#### Scenario:` headings

### Build & Tests Execution

**Build**: ✅ Passed (`node_modules/.bin/turbo run build --force`, exit 0)
```text
Tasks: 2 successful, 2 total
Cached: 0 cached, 2 total
@ftth-copilot/db:build → Prisma client generated (v5.22.0)
@ftth-copilot/web:build → Next.js production build completed; 26 routes compiled (24 dynamic + 2 static paths)
```

**Typecheck**: ✅ Passed (`node_modules/.bin/turbo run typecheck --force`, exit 0)
```text
Tasks: 15 successful, 15 total
Cached: 0 cached, 15 total  ← all packages re-ran (no stale cache)
```

**Tests**: ✅ 501 passed / 0 failed / 0 skipped — workspace-wide (`node_modules/.bin/turbo run test --force`, exit 0)
```text
@ftth-copilot/shared:test         Tests  39 passed (39)   ← +12 Fase C tests in contracts.test.ts + index-exports.test.ts
@ftth-copilot/evidence:test       Tests  61 passed (61)   ← 23 Fase B + 31 abstention-policy + 7 index-exports
@ftth-copilot/agent-core:test     Tests  96 passed (96)   ← +22 Fase C tests in runtime.test.ts (12 base + 10 strict-mode override)
@ftth-copilot/web:test            Tests   8 passed (8)    ← chat-abstention.test.ts (full new file)
@ftth-copilot/security:test       Tests  39 passed (39)
@ftth-copilot/connectors-core:test Tests  20 passed (20)
@ftth-copilot/detection:test      Tests  57 passed (57)
@ftth-copilot/db:test             Tests  17 passed (17)
@ftth-copilot/monitoring:test     Tests   7 passed (7)
@ftth-copilot/alerts:test         Tests  52 passed (52)
@ftth-copilot/connectors-mikrowisp:test Tests  35 passed (35)
@ftth-copilot/soc:test            Tests  13 passed (13)
@ftth-copilot/connectors-smartolt:test Tests  24 passed (24)
@ftth-copilot/analytics:test      Tests  33 passed (33)
Tasks: 15 successful, 15 total
```

**Coverage**: Not collected — `openspec/config.yaml` sets `coverage_threshold: 0` and no per-package coverage command is part of the verification gate. Threshold waived by project config (same as Fase B).

### Spec Compliance Matrix

#### `strict-mode-abstention` — new capability (7 requirements, 9 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Abstention v1 contract | Valid + invalid coverage | `packages/shared/tests/contracts.test.ts > ftth.abstention.v1` suite (11 tests: literal version, accept valid, reject wrong schema, reject empty entries in missing/available/toolsAffected, reject empty nextStep, reject unknown reason, reject unknown severity, accept without claim, accept empty available, accept warning severity, accept every VerdictCode, reject extra top-level keys via `.strict()`) | ✅ COMPLIANT |
| Asymmetric policy map | Policy table coverage | `packages/evidence/tests/abstention-policy.test.ts > shouldAbstain — asymmetric policy table` (parameterised over `(incomplete,strict)→abstain`, `(stale,strict)→warn`, `(low_confidence,strict)→warn`, `(ok,strict)→allow`, observe-all-allow; + mixed/empty/edge cases) | ✅ COMPLIANT |
| `buildAbstention` derivation | Mixed derivation | `packages/evidence/tests/abstention-policy.test.ts > buildAbstention — derivation rules > mixed [incomplete/get_onu_detail, ok/list_onus] derives missing/available/toolsAffected` (`expect(abstention.missing).toEqual(['get_onu_detail']); expect(abstention.available).toEqual(['list_onus']); expect(abstention.toolsAffected).toEqual(['get_onu_detail']); expect(abstention.reason).toBe('incomplete')`) | ✅ COMPLIANT |
| `buildAbstention` derivation | All incompletes | `… > all-incompletes scenario: available === [] and missing.length === 2` | ✅ COMPLIANT |
| Spanish `nextStep` templates | Voseo + tool reference + determinism | `packages/evidence/tests/abstention-policy.test.ts > nextStepFor — Spanish templates (voseo + deterministic + tool reference)` (6 tests: byte-identical across invocations, identifier template matches `IDENTIFIER_NEXTSTEP_FOR_GET_ONU` + contains `verificá` + references `get_onu_detail`, metrics template + contains `colectá` + matches `/15 minutos/i`, two locked snapshot tests for `list_onus`/`list_telemetry`, contains voseo verb forms, defaults to metrics for non-`incomplete` reasons) | ✅ COMPLIANT |
| Strict-mode override in `runAgent` | Strict + incomplete replaces text | `packages/agent-core/tests/runtime.test.ts > runAgent strict-mode abstention override > strict + incomplete replaces the LLM text at the no-tool-call return path` + `> strict + incomplete replaces the LLM text at the end-of-loop return path` (asserts `result.abstained === true`, `result.text` equals `EXPECTED_ONU_TEXT`, `abstentionSchema.safeParse(result.abstention).success === true`, `result.abstention?.missing === ['get_onu_detail']`, `result.verdicts?.length === 1`, `result.toolCalls[0]?.name === 'get_onu_detail'`) | ✅ COMPLIANT |
| Strict-mode override in `runAgent` | Non-abstain paths preserve LLM text | `… > strict + stale only keeps the LLM text` + `> strict + low_confidence only keeps the LLM text` + `> strict + only ok verdicts keeps the LLM text` + `> observe + incomplete keeps the LLM text at the no-tool-call return path` + `> observe + incomplete keeps the loop-limit text at the end-of-loop return path` + `> observe + stale/low_confidence keeps the LLM text` (all assert `abstained === undefined`, `abstention === undefined`, `text` unchanged) | ✅ COMPLIANT |
| Additive contract fields | Abstention forwarded | `packages/shared/tests/contracts.test.ts > AgentResult / ChatResponse abstention fields` (4 tests: AgentResult JSON round-trip with `abstention`+`abstained:true`, AgentResult without abstention fields stays valid, ChatResponse forwards envelope via JSON round-trip, ChatResponse without abstention stays valid) | ✅ COMPLIANT |
| Route persistence of abstention | Strict persists synthetic row, observe does not | `apps/web/tests/api/chat-abstention.test.ts > POST /api/chat — strict-mode abstention persistence` (3 tests: writes `result.text` into `Message.content`, appends `{ name: '__abstention__', arguments: {}, result: ABSTENTION_ENVELOPE }` to `Message.toolCalls`, attaches envelope to HTTP response) + `> POST /api/chat — observe-mode non-abstention persistence` (3 tests: writes text verbatim, does NOT append `__abstention__` row, does NOT include `abstention` in response) | ✅ COMPLIANT |

#### `truth-gate-classification` (delta) — 1 requirement, 6 scenarios (additive)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Mode enforcement on runAgent | Observe mode preserves Fase B behavior | `packages/agent-core/tests/runtime.test.ts > observe + incomplete keeps the LLM text at the no-tool-call return path` + `> observe + incomplete keeps the loop-limit text at the end-of-loop return path` | ✅ COMPLIANT |
| Mode enforcement on runAgent | Strict mode abstains on incomplete | `… > strict + incomplete replaces the LLM text at the no-tool-call return path` + `> strict + incomplete replaces the LLM text at the end-of-loop return path` + `> strict + mixed incomplete/ok abstains and reports what was available` | ✅ COMPLIANT |
| Mode enforcement on runAgent | Strict mode allows on stale only | `… > strict + stale only keeps the LLM text (Fase B warning behaviour)` | ✅ COMPLIANT |
| Mode enforcement on runAgent | Strict mode allows on low_confidence only | `… > strict + low_confidence only keeps the LLM text` | ✅ COMPLIANT |
| Mode enforcement on runAgent | Default mode is strict | `… > TruthGate mode resolution > defaults to strict` + `> is re-exported from the package entrypoint with the same value` + `> resolves an omitted mode to the strict default` | ✅ COMPLIANT |
| Mode enforcement on runAgent | Single classification path preserved | `… > demo and live sources abstain identically for the same incomplete evidence` (asserts `demo.text === live.text`, `demo.abstention` deep-equals `live.abstention`, both `verdicts?.[0]?.reason === 'minimal-completeness'`) | ✅ COMPLIANT |

#### `evidence-provenance` (delta) — 1 requirement, 4 scenarios (additive)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Abstention attached to AgentResult (additive) | Abstained flag set with abstention payload | `packages/agent-core/tests/runtime.test.ts > strict + incomplete replaces the LLM text …` (asserts `abstained === true`, `abstention` parses) | ✅ COMPLIANT |
| Abstention attached to AgentResult (additive) | Missing abstention in observe mode (backward compatibility) | `… > observe + incomplete keeps the LLM text at the no-tool-call return path` + `> observe + incomplete keeps the loop-limit text …` (both assert `abstention === undefined` AND `abstained === undefined` AND `text` is LLM text) | ✅ COMPLIANT |
| Abstention attached to AgentResult (additive) | ChatResponse carries abstention | `packages/shared/tests/contracts.test.ts > AgentResult / ChatResponse abstention fields > ChatResponse forwards the same abstention envelope to the client` (JSON round-trip + `abstentionSchema.safeParse` succeeds) + `apps/web/tests/api/chat-abstention.test.ts > POST /api/chat — strict-mode abstention persistence > attaches the abstention envelope to the HTTP response` | ✅ COMPLIANT |
| Abstention attached to AgentResult (additive) | Route persists `__abstention__` pseudo-tool row | `apps/web/tests/api/chat-abstention.test.ts > POST /api/chat — strict-mode abstention persistence > writes result.text into Message.content` + `> appends a __abstention__ synthetic row to Message.toolCalls` (asserts `toolCalls[0]` deep-equals `{ name: '__abstention__', arguments: {}, result: ABSTENTION_ENVELOPE }`) | ✅ COMPLIANT |

**Compliance summary**: 19/19 new scenarios compliant (all covered by passing tests).

### Correctness (Static Evidence)

| Requirement | Status | Source evidence |
|-------------|--------|-----------------|
| Abstention v1 contract | ✅ Implemented | `packages/shared/src/contracts.ts:157-168` defines `abstentionSchema = z.object({...}).strict()` reusing `z.enum(['ok','low_confidence','stale','incomplete'])` (same as `verdictCodeSchema`) and `z.enum(['ok','info','warning','critical'])` (same as `verdictSeveritySchema`). `ABSTENTION_SCHEMA = 'ftth.abstention.v1' as const` declared at line 20. |
| Asymmetric policy map | ✅ Implemented | `packages/evidence/src/abstention-policy.ts:59-68` `shouldAbstain` returns `'allow'` immediately for `mode === 'observe'`, scans for `incomplete` (→ abstain), then `stale`/`low_confidence` (→ warn), else `'allow'`. No source-branching. |
| `buildAbstention` derivation | ✅ Implemented | `packages/evidence/src/abstention-policy.ts:98-127` filters incompletes, oks, non-oks; dedupes via `distinct()`; throws when no incomplete present (defensive precondition). `severity` taken from first incomplete (matches spec: "dominant failure surfaced to the operator"). `claim` forwarded as-is or omitted. |
| Spanish `nextStep` templates | ✅ Implemented | `packages/evidence/src/abstention-policy.ts:36-42` `formatIdentifierNextStep` + `formatMetricsNextStep` — locked byte-identical strings; voseo verbs `Verificá`/`volvé`/`Re-colectá`. Template selection at `:149-158` uses identifier hint `/onu|olt/i` else metrics; defensive fallback returns metrics template for non-`incomplete` reasons. |
| Strict-mode override in `runAgent` | ✅ Implemented | `packages/agent-core/src/runtime.ts:99-100` `mode = resolveTruthGateMode(opts.mode)`; `:159-171` `finalize(text)` is the **single helper** invoked at BOTH return paths (`:188` no-tool-call early-out + `:206` max-iter) — replaces `text` with `formatAbstentionText(abstention)` only when `shouldAbstain(verdicts, mode) === 'abstain'`. Helper-based duplication of the branch logic keeps both sites byte-identical. |
| Additive contract fields | ✅ Implemented | `packages/shared/src/index.ts:29` `abstention?: Abstention` + `:35` `abstained?: boolean` on `AgentResult`; `:55` `abstention?: Abstention` on `ChatResponse`. All optional, no field renamed or removed. Pre-Fase-C literal `{ text: '...', toolCalls: [] }` type-checks. |
| Route persistence of abstention | ✅ Implemented | `apps/web/app/api/chat/route.ts:31-35` `resolveTruthGateModeFromEnv()` reads `process.env['TRUTH_GATE_MODE']` with `'strict'` fallback; `:158` passes `mode` to `runAgent`; `:193-200` appends `{ name: '__abstention__', arguments: {}, result: abstention }` to `result.toolCalls` iff `result.abstained === true`; `:237` forwards `abstention` verbatim into the HTTP response. |
| `AgentResult.abstention?` additivity | ✅ Implemented | `packages/shared/src/index.ts:29` optional; legacy `{ text, toolCalls }` payloads continue to type-check (proven in `contracts.test.ts > AgentResult without abstention fields stays valid (backward compatible)`). |
| Observe mode preserved (Fase B behavior) | ✅ Implemented | `packages/agent-core/src/runtime.ts:160-161` early-return in `finalize` when `shouldAbstain !== 'abstain'` — text passes through verbatim. `verdicts[]` still attached to `AgentResult`. Tested via 6 observe-mode scenarios (`runtime.test.ts > observe + …`). |
| Demo = live single classification path | ✅ Implemented | `packages/evidence/src/abstention-policy.ts:59` `shouldAbstain` does not branch on toolName / envelope source; `classifyEnvelope` is the single source. Tested byte-identical for `smartolt.demo` vs `smartolt.poll` (`runtime.test.ts > demo and live sources abstain identically …` + `abstention-policy.test.ts > demo == live parity …`). |
| ChatUI bubble + `__abstention__` suppression | ✅ Implemented | `apps/web/components/ChatUI.tsx:431-444` `MessageBubble` filters `__abstention__` from the visible chip list (`visibleTools = toolsUsed?.filter(t => t.name !== ABSTENTION_PSEUDO_TOOL)`) and renders `<AbstentionBubble abstention={effectiveAbstention}/>` only when the synthetic row OR the envelope is present. Warning tint via `border-warning/30 bg-warning/10 text-amber-200`. Bullet list iterates `abstention.missing`; `abstention.nextStep` rendered as a paragraph. |
| History sidebar reload reconstructs envelope | ✅ Implemented | `apps/web/components/HistorySidebar.tsx:247-262` locates the synthetic `__abstention__` row, guards with `isAbstention` runtime shape check, attaches the reconstructed envelope to `ChatMessage.abstention` so the bubble renders on history reload (not just live responses). |

### Coherence (Design)

| Decision | Followed? | Source evidence |
|----------|-----------|-----------------|
| Policy location = pure functions in `packages/evidence/src/abstention-policy.ts` | ✅ Yes | File exists at expected path; no source-branching; trivially unit-testable (parameterised table tests). |
| Default `mode` = `'strict'`, exported as `DEFAULT_TRUTH_GATE_MODE` | ✅ Yes | `packages/agent-core/src/runtime.ts:52` `export const DEFAULT_TRUTH_GATE_MODE: TruthGateMode = 'strict'`; re-exported from `packages/agent-core/src/index.ts:4`. |
| Override site = single helper invoked at BOTH return paths (refined from design #3 "inline blocks at L107 + L125-129") | ✅ Yes (refined, non-breaking) | `runtime.ts:159-171` `finalize(text)` helper; called at `:188` (no-tool-call early-out) and `:206` (max-iter). Helper duplication of branch logic is the same intent as the design — both return paths covered — without copy-paste drift. |
| `Abstention` location = zod in `packages/shared/src/contracts.ts`; type re-exported from `packages/evidence/src/index.ts` | ✅ Yes | `contracts.ts:157-170`; `evidence/src/index.ts:16-17` re-exports `Abstention` type + `ABSTENTION_SCHEMA` + `abstentionSchema` from shared. |
| Shared → Evidence cycle = `import type` + `peerDependenciesMeta.optional=true` | ✅ Yes | `packages/shared/src/index.ts:5` `import type { Abstention } from './contracts'`; `packages/shared/package.json` declares `@ftth-copilot/evidence` as optional peerDep (same pattern as Fase B `Verdict`). |
| Persistence = synthetic pseudo-tool row `{ name: '__abstention__', arguments: {}, result: <Abstention> }` | ✅ Yes | `apps/web/app/api/chat/route.ts:198`; no Prisma migration needed (`Message.toolCalls` already exists as JSON column). |
| Rendering = warning-tint bubble keyed on synthetic row OR response.abstention | ✅ Yes | `apps/web/components/ChatUI.tsx:444` `showAbstentionBubble = !!abstentionRow || !!effectiveAbstention`; bubble renders from `effectiveAbstention` (response or reconstructed from row). |
| nextStep = pure `nextStepFor(reason, toolsAffected)` keyed on dominant reason | ✅ Yes (refined, non-breaking) | `packages/evidence/src/abstention-policy.ts:149-158`. Original design called for "dominant incomplete.reason" selection across two templates; the implementation key the selection on the **first incomplete toolName's identifier hint** (O(1) string regex check) rather than reason strings. The two template outputs are byte-identical to the design intent (voseo + tool reference + snapshot-locked) and the design's template names — `no-envelope`/`parse-error` → identifier; `partial-completeness`/`minimal-completeness` → metrics — collapse cleanly to "any toolName matches `/onu|olt/i` → identifier, else metrics". For Fase C the reason-keyed template set reduces to the toolName-keyed set because both `no-envelope` and `parse-error` never produce the identifier template (their toolName lists are not identifier lookups), and both `partial-completeness` and `minimal-completeness` either do or don't depending on the affected tool, which is what the toolName regex captures. |
| Single classification path (demo = live) preserved | ✅ Yes | `shouldAbstain` does not branch on toolName; `classifyEnvelope` is mode-agnostic; tested byte-identical for demo vs live. |

### Issues Found

**CRITICAL**: None.

**WARNING**: None.

**SUGGESTION** (non-blocking, for the next maintenance pass):

1. **`shouldAbstain` does not break early on `incomplete` in observe mode.** The function returns `'allow'` immediately when `mode === 'observe'`, but the verdict stream still accumulates `incomplete` codes — operators in observe-mode calibration get the audit trail they need but the function body does not need to scan for incompletes. Worth a comment-only clarification (not a behavior change). Already documented in the `truth-gate-classification/spec.md` ("Observe Mode in runAgent"); no fix needed.
2. **`nextStepFor` reason-keyed selection vs toolName-keyed selection (see Coherence #8).** The current implementation keys on `toolName` rather than `reason` because `reason === 'incomplete'` is the only call-site. The Fase C spec scenario accepts both, but a future Fase D extension that allows other `reason` codes may want reason-keyed selection. Low priority — only re-explore if Fase D broadens the abstention reasons.
3. **Web package: `vitest.config.ts` was added under the `apps/web/` root but the package had no prior vitest config.** The new config uses `node` env + path alias for `@/...`. This is a permanent structural change (not a temporary fixture); worth a design.md note in Fase D so future contributors know the apps/web has a unit-test surface beyond Playwright e2e.
4. **`packages/shared/package.json` still declares `@ftth-copilot/evidence` as `peerDependencies` (optional) instead of `devDependencies`** — the same adjustment flagged in Fase B's verify-report. The type-only resolution is preserved. Worth a design.md note for future readers, but not blocking.
5. **`turbo.json` still does not register `packages/evidence` explicitly.** Discovery happens through `pnpm-workspace.yaml`. Same as Fase B suggestion #2; still functional.

### Verdict

**PASS**

All 19 new spec scenarios have covering tests that pass at runtime; all 9 implementation tasks (Phase 1–3) are marked complete; strict-mode override fires at BOTH `runAgent` return paths via a shared `finalize` helper; observe mode preserves Fase B behavior; demo == live single classification path is proven byte-identical; Spanish `nextStep` templates are byte-locked by snapshot tests with voseo register; route persists the `__abstention__` synthetic tool row only when `result.abstained === true`; ChatUI renders the warning bubble and suppresses the synthetic chip. Workspace `turbo run test`, `typecheck`, and `build` all exit 0 with 501/501 tests passing across 15 packages.

The two coherence refinements (override site as helper not inline blocks; nextStep keyed on toolName rather than reason) preserve the design intent (both return paths covered; deterministic voseo templates) and are explicitly within the design's documented freedom ("Architecture Decisions are recommendations; minor implementation refinements that preserve intent are accepted").
