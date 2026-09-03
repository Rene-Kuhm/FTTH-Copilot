# Archive Report: fase-c-strict-abstention

**Date**: 2026-09-03
**Status**: archived
**Mode**: openspec (hybrid-ready: engram memory recorded separately)
**Branch**: `feat/fase-c-strict-abstention`

## Change Summary

Fase C — Strict Mode / Abstention (asymmetric v1): flip the Fase B
Truth Gate from observation to enforcement. When evidence is
`incomplete`, `runAgent` in `strict` mode replaces the LLM's text
with a deterministic `ftth.abstention.v1` payload so the agent never
fabricates from missing or non-parseable data. `stale` and
`low_confidence` stay as warnings — calibration signal is preserved.
`strict` is the default; `observe` is reachable for Fase B parity.

## Outcome

- **Verdict**: PASS (0 CRITICAL, 0 WARNING)
- **Specs synced**: 3 (1 created, 2 extended)
- **Tests**: 501 passed / 0 failed / 0 skipped — workspace-wide
- **Build**: OK (`turbo run build --force` exit 0)
- **Typecheck**: OK (`turbo run typecheck --force` exit 0; 15/15)
- **SDD cycle**: complete

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `strict-mode-abstention` | **Created** | Full spec promoted to `openspec/specs/strict-mode-abstention/spec.md` (7 requirements, 9 scenarios) — mechanical `cp` + `mv`, `diff -r` empty |
| `truth-gate-classification` | **Extended (additive)** | New `## ADDED Requirements (Fase C)` section appended (1 requirement, 6 scenarios): `Mode enforcement on runAgent` — observe preserves Fase B, strict abstains on incomplete, allows on stale/`low_confidence`-only, defaults to strict, single classification path preserved. No Fase A or Fase B content removed or renamed. Canonical post-merge: 10 requirements, 25 scenarios (was 9 + 19). |
| `evidence-provenance` | **Extended (additive)** | New `## ADDED Requirements (Fase C)` section appended (1 requirement, 4 scenarios): `Abstention attached to AgentResult (additive)` — `AgentResult.abstention?`/`abstained?` + `ChatResponse.abstention?` fields, `__abstention__` synthetic pseudo-tool row in `Message.toolCalls`. No Fase A or Fase B content removed or renamed. Canonical post-merge: 9 requirements, 33 scenarios (was 8 + 29). |

## Archive Contents

- `proposal.md` ✅
- `specs/strict-mode-abstention/spec.md` ✅ (delta — promoted to canonical)
- `specs/truth-gate-classification/spec.md` ✅ (delta — merged into canonical)
- `specs/evidence-provenance/spec.md` ✅ (delta — merged into canonical)
- `design.md` ✅
- `tasks.md` ✅ (9/9 implementation tasks marked `[x]`; Phase 4 4.1–4.2 closed by this work)
- `verify-report.md` ✅

## Source of Truth Updated

- `openspec/specs/strict-mode-abstention/spec.md` — new canonical spec for the asymmetric strict-mode abstention capability
- `openspec/specs/truth-gate-classification/spec.md` — Fase B spec extended with the additive `Mode enforcement on runAgent` requirement + 6 scenarios
- `openspec/specs/evidence-provenance/spec.md` — Fase A + Fase B spec extended with the additive `Abstention attached to AgentResult` requirement + 4 scenarios
- `packages/evidence/README.md` — updated with a new "Strict-mode abstention (Fase C)" section: asymmetric policy table, `shouldAbstain` / `buildAbstention` / `nextStepFor` / `formatIdentifierNextStep` / `formatMetricsNextStep` API surface, `TRUTH_GATE_MODE` env-var rollback, three-tier rollback playbook

## Task Completion Gate

All 9 implementation tasks (Phase 1.1–1.3, 2.1–2.3, 3.1–3.3) marked `[x]` in `tasks.md`. Phase 4 (verify + docs + archive) is closed by this archive operation. No stale unchecked tasks. No exceptional reconciliation performed.

## Verification Summary

| Metric | Value |
|--------|-------|
| Requirements | 9/9 new compliant (`strict-mode-abstention` 7 + `truth-gate-classification` 1 + `evidence-provenance` 1) |
| Scenarios | 19/19 new compliant (9 + 6 + 4) |
| Tests | 501 passed / 0 failed / 0 skipped |
| Build | OK (`turbo run build --force` exit 0) |
| Typecheck | OK (`turbo run typecheck --force` exit 0; 15/15, no cache) |
| `@ftth-copilot/shared:test` | 39 passed (incl. `contracts.test.ts` Fase C additivity + `index-exports.test.ts` ABSTENTION_SCHEMA re-export) |
| `@ftth-copilot/evidence:test` | 61 passed (incl. `abstention-policy.test.ts` 31 cases + `index-exports.test.ts` 7 re-exports) |
| `@ftth-copilot/agent-core:test` | 96 passed (incl. `runtime.test.ts` 30 cases — 6 strict-mode override scenarios + demo = live parity + formatAbstentionText snapshots + observe-mode regression) |
| `@ftth-copilot/web:test` | 8 passed (new `chat-abstention.test.ts` — 3 strict-mode persistence + 3 observe-mode non-persistence + 2 TRUTH_GATE_MODE passthrough cases) |
| CRITICALs | 0 |
| WARNINGs | 0 |

## Files Touched (implementation, for reference)

| File | Action | Note |
|------|--------|------|
| `packages/shared/src/contracts.ts` | Modified | `ABSTENTION_SCHEMA` + `abstentionSchema` (zod `.strict()`); reuses `verdictCodeSchema`/`verdictSeveritySchema` |
| `packages/shared/src/index.ts` | Modified | `import type { Abstention }`; `AgentResult.abstention?` + `abstained?`; `ChatResponse.abstention?`; re-exports `ABSTENTION_SCHEMA` + `abstentionSchema` |
| `packages/shared/tests/contracts.test.ts` | Modified | 12-case `ftth.abstention.v1` golden suite + 4-case `AgentResult/ChatResponse abstention fields` JSON round-trip suite |
| `packages/shared/tests/index-exports.test.ts` | Modified | Re-export coverage for `ABSTENTION_SCHEMA`, `abstentionSchema`, `Abstention` |
| `packages/evidence/src/abstention-policy.ts` | Created | `shouldAbstain` / `buildAbstention` / `nextStepFor` / `formatIdentifierNextStep` / `formatMetricsNextStep` (pure) |
| `packages/evidence/src/index.ts` | Modified | Re-exports `ABSTENTION_SCHEMA`, `abstentionSchema`, `Abstention`, `shouldAbstain`, `buildAbstention`, `nextStepFor`, `formatIdentifierNextStep`, `formatMetricsNextStep`, `TruthGateMode`, `AbstentionDecision` |
| `packages/evidence/tests/abstention-policy.test.ts` | Created | 31 tests: policy table, derivation, snapshot, voseo invariants, demo == live parity |
| `packages/evidence/tests/index-exports.test.ts` | Created | 7 tests for re-exports + Fase B regression |
| `packages/agent-core/src/runtime.ts` | Modified | `mode?: 'strict' | 'observe'` on `RunAgentOptions`; `DEFAULT_TRUTH_GATE_MODE='strict'`; `formatAbstentionText(abstention)` helper; `finalize(text)` shared helper invoked at BOTH return paths (no-tool-call early-out + max-iter) |
| `packages/agent-core/src/index.ts` | Modified | Re-exports `DEFAULT_TRUTH_GATE_MODE`, `resolveTruthGateMode`, `TruthGateMode` |
| `packages/agent-core/tests/runtime.test.ts` | Modified | 30 cases: 12 Fase B baseline + 6 strict-mode override + 4 observe-mode regression + 4 formatAbstentionText snapshots + 1 demo == live parity + 3 mode-resolution |
| `apps/web/app/api/chat/route.ts` | Modified | `resolveTruthGateModeFromEnv()` reads `process.env['TRUTH_GATE_MODE']` (default `'strict'`); on `result.abstained === true` appends `{ name: '__abstention__', arguments: {}, result: result.abstention }` to `Message.toolCalls`; forwards `abstention` into `ChatResponse` |
| `apps/web/vitest.config.ts` | Created | Node-env vitest config for `apps/web/` with path alias `@/` |
| `apps/web/package.json` | Modified | `vitest` + `@vitest/coverage-v8` devDependencies |
| `apps/web/tests/api/chat-abstention.test.ts` | Created | 8 tests: 2 TRUTH_GATE_MODE passthrough (observe + default strict) + 3 strict-mode persistence (content / `__abstention__` row / response body) + 3 observe-mode non-persistence |
| `apps/web/components/ChatUI.tsx` | Modified | `ChatMessage.abstention?` field; `MessageBubble` filters `__abstention__` from chip list; new `<AbstentionBubble>` warning component |
| `apps/web/components/HistorySidebar.tsx` | Modified | On history reload, reconstructs the `Abstention` envelope from the synthetic `__abstention__` row via `isAbstention()` runtime guard |
| `apps/web/e2e/chat-abstention.spec.ts` | Created | 2 Playwright e2e tests: warning bubble renders for abstention; absent for non-abstention |
| `packages/evidence/README.md` | Modified | New "Strict-mode abstention (Fase C)" section: asymmetric policy table, API surface, env-var override, three-tier rollback playbook |

## Coherence Adjustments (documented, not blocking)

1. **`runAgent` override site is a `finalize(text)` helper invoked at BOTH return paths** instead of two inline blocks at `runtime.ts:107` + `runtime.ts:125-129` (design table expectation). The intent — both return paths covered, no `result.text` leakage — is preserved and is now provably identical at both sites (helper duplication of branch logic eliminates copy-paste drift). Net change: ~8 lines saved; tests now exercise the same helper code at both return paths.
2. **`nextStepFor` template selection keys on `toolName` identifier hint (`/onu|olt/i`) instead of `reason` string** (`abstention-policy.ts:149-158`). The design specified "dominant incomplete.reason" selection across two templates; the implementation collapses cleanly to toolName-keyed selection because every reason string is tied to a toolName that triggers the correct template via the hint regex. Byte-identical output for every input the spec scenarios test (verified by snapshot tests).
3. **Apps/web gained a vitest config (`apps/web/vitest.config.ts`) + devDependencies**. Previously the only test surface was Playwright e2e. The new config enables Node-env unit testing for the route handler — required for the strict-mode persistence scenarios without spinning up a Next dev server.
4. **`packages/shared/package.json` still declares `@ftth-copilot/evidence` as `peerDependencies` (optional) instead of `devDependencies`** — same as Fase B. The type-only resolution is preserved; the swap was required to avoid a fatal pnpm workspace cycle.
5. **`turbo.json` does not register `packages/evidence` explicitly.** Discovery through `pnpm-workspace.yaml`. Same as Fase B suggestion; still functional.

## Final-State Facts

- Apply: 9/9 tasks, 11 commits on `feat/fase-c-strict-abstention` (last apply commit `ce94863` "feat(web): render abstention as distinct bubble...")
- Verify: PASS — 501 tests, 0 warnings, 0 critical findings; evidence-revision `sha256:61a7e986c3aa7127c238d0c9dd7c46f78c647ab32134af76219e3a349dfeda78`
- Verify-report: 2 commits (`4a35410` body + `3af862f` envelope pin); 163 lines
- Tests reported are the final counts from `turbo run test --force` (501 passed), not an intermediate snapshot

## Forward Note for Fase D (per-tenant policy + telemetry)

The Fase C gate is **single-tenant, single-decision**: every strict-mode run with any `incomplete` verdict abstains with the same asymmetric policy. The Spanish `nextStep` is one of two fixed templates. Fase D should:

1. **Per-tenant policy hooks** — extend `shouldAbstain(verdicts, mode, tenantPolicy?)` to accept a tenant-provided override map (e.g. specific tenants may want to abstain on `stale` too, or downgrade `incomplete` to a warning). Policy would live alongside the `ConnectorResolution` config and survive the same env-var override mechanism.
2. **Telemetry sink** — when an abstention fires, mirror `{ conversationId, tenantId, abstention, verdicts }` to a sink (Fase F candidates: Postgres `abstention_event` table, OpenTelemetry span, webhooks). This enables calibration: which tools fail most often, which `nextStep` template operators ignore, whether `observe`-mode simulations drift from `strict`-mode outcomes.
3. **Additional `nextStep` templates** — current templates cover identifier-lookup (`get_onu_detail`) and metrics (`get_metrics`). New tools will surface new reason codes (`low_confidence / missing-confidence`, `stale / expired-ttl`, etc.). The current `nextStepFor` defensive fallback returns the metrics template for any non-`incomplete` reason; consider a per-`reason` lookup table when the reason count grows past 3-4.
4. **Recommended tag** — `// Fase C: strict-mode entry point` marker next to `finalize()` in `packages/agent-core/src/runtime.ts` to make the override site obvious for future maintainers (mirrors Fase B suggestion #3).
5. **ChatUI: render `__abstention__` chip optionally** — current behavior hides the synthetic row. Operators in calibration mode might want to see the raw row alongside the bubble for debugging; a `?showAbstentionChip=1` query param or an admin-only debug overlay would close the loop.
6. **Re-examine thresholds** — Fase B's `confidence < 0.3` and `now > observedAt + ttlMs` are initial conservative defaults. With Fase C telemetry in place, recalibrate against real distribution data and consider per-tenant defaults.

No design changes are required to the `Abstention` envelope itself; it already carries `schema`, `reason`, `severity`, `claim?`, `missing`, `available`, `nextStep`, `toolsAffected`. The only structural extension needed for Fase D is an optional `policyOverrides?` field on the envelope, applied by `buildAbstention` only when a tenant override is supplied.

## SDD Cycle Complete

The change has been fully planned, designed, specified, implemented, verified, and archived. The asymmetric strict-mode abstention is live; the chat route persists the `__abstention__` row; the ChatUI renders the warning bubble; `observe` mode is one env var away for any deployment that needs Fase B parity. Ready for Fase D.

## Mechanical Copy Readback (audit trail)

```text
# strict-mode-abstention promotion (Step 2)
$ diff -r openspec/changes/fase-c-strict-abstention/specs/strict-mode-abstention/spec.md \
          openspec/specs/strict-mode-abstention/spec.md
(empty — byte-identical)

# truth-gate-classification merge (Step 2 — additive, not byte-identical by design)
Source:  openspec/changes/fase-c-strict-abstention/specs/truth-gate-classification/spec.md  (49 lines)
Target:  openspec/specs/truth-gate-classification/spec.md                                    (212 lines, +48 vs. Fase B canonical: 9 req + 19 scen → 10 req + 25 scen)
Merge:   +1 requirement ("Mode enforcement on runAgent") + 6 scenarios appended under a new "## ADDED Requirements (Fase C)" section before the existing "## Key Learnings"
         All Fase A + Fase B requirements/scenarios preserved verbatim.

# evidence-provenance merge (Step 2 — additive, not byte-identical by design)
Source:  openspec/changes/fase-c-strict-abstention/specs/evidence-provenance/spec.md  (39 lines)
Target:  openspec/specs/evidence-provenance/spec.md                                    (260 lines, +43 vs. Fase B canonical: 8 req + 29 scen → 9 req + 33 scen)
Merge:   +1 requirement ("Abstention attached to AgentResult (additive)") + 4 scenarios appended at the end under a new "## ADDED Requirements (Fase C)" section
         All Fase A + Fase B requirements/scenarios preserved verbatim.

# change folder archive move (Step 3)
$ diff -r <snapshot_root>/source openspec/changes/archive/2026-09-03-fase-c-strict-abstention
(empty — byte-identical; git mv succeeded on first attempt)
```
