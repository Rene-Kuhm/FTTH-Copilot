# Archive Report: fase-b-truth-gate

**Date**: 2026-09-03
**Status**: archived
**Mode**: openspec (hybrid-ready: engram memory recorded separately)
**Branch**: `feat/fase-b-truth-gate`

## Change Summary

Fase B — Truth Gate (observation mode): a **pure TypeScript evidence classifier** that tags every `evidence.provenance.v1` envelope with a `Verdict` (`stale | low_confidence | incomplete | ok`) and attaches verdicts to `AgentResult` for downstream calibration. Observe mode only — verdicts are recorded, but the data reaching the LLM is **unchanged**.

## Outcome

- **Verdict**: PASS (0 CRITICAL, 0 WARNING)
- **Specs synced**: 2 (1 created, 1 extended)
- **Tests**: 414 passed / 0 failed / 0 skipped — workspace-wide
- **Build**: OK (turbo 2/2); **Typecheck**: OK (turbo 15/15)
- **SDD cycle**: complete

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `truth-gate-classification` | **Created** | Full spec promoted to `openspec/specs/truth-gate-classification/spec.md` (9 requirements, 19 scenarios) — mechanical `cp` + `mv`, `diff -r` empty |
| `evidence-provenance` | **Extended (additive)** | Fase A `Threading de tenantId` requirement body gains the `verdicts` clause + `(Previously: …)` note; 2 new scenarios appended (`Verdicts attached to AgentResult`, `Missing verdicts for backward compatibility`). No Fase A content removed or renamed. |

## Archive Contents

- `proposal.md` ✅
- `specs/truth-gate-classification/spec.md` ✅
- `specs/evidence-provenance/spec.md` ✅ (delta)
- `design.md` ✅
- `tasks.md` ✅ (12/12 tasks complete, all `[x]`)
- `verify-report.md` ✅

## Source of Truth Updated

- `openspec/specs/truth-gate-classification/spec.md` — new canonical spec for the Truth Gate capability
- `openspec/specs/evidence-provenance/spec.md` — Fase A spec extended with the additive `verdicts` requirement clause and 2 new scenarios

## Task Completion Gate

All 12 implementation tasks marked `[x]` in `tasks.md` (Phase 1.1, 2.1–2.5, 3.1, 4.1–4.2, 5.1–5.2, 6.1). No stale unchecked tasks. No exceptional reconciliation performed.

## Verification Summary

| Metric | Value |
|--------|-------|
| Requirements | 10/10 compliant (`truth-gate-classification` 9 + `evidence-provenance` 1) |
| Scenarios | 23/23 compliant (`truth-gate-classification` 19 + `evidence-provenance` 4) |
| Tests | 414 passed / 0 failed / 0 skipped |
| Build | OK (`turbo run build --force` exit 0) |
| Typecheck | OK (`turbo run typecheck` exit 0; 15/15) |
| `@ftth-copilot/evidence:test` | 23 passed |
| `@ftth-copilot/agent-core:test` | 74 passed (incl. `runtime.test.ts`) |
| `@ftth-copilot/shared:test` | 20 passed (incl. `contracts.test.ts` Fase B additivity) |
| CRITICALs | 0 |
| WARNINGs | 0 |

## Files Touched (implementation, for reference)

| File | Action | Note |
|------|--------|------|
| `packages/evidence/{package.json,tsconfig.json,vitest.config.ts}` | Created | New package — mirrors `packages/security/` shape |
| `packages/evidence/src/{types.ts,truth-gate.ts,index.ts}` | Created | `Verdict` types + classifier + barrel |
| `packages/evidence/tests/truth-gate.test.ts` | Created | 23 test cases (table + priority + parse-error) |
| `packages/evidence/README.md` | Created | Public API + thresholds + observe-mode invariant |
| `packages/agent-core/src/runtime.ts` | Modified | Module-scope `verdicts[]` accumulator + `classifyToolResult` helper at both return paths |
| `packages/agent-core/src/index.ts` | Modified | Re-exports `Verdict`, `classifyEnvelope`, `classifyUnwrapped` |
| `packages/agent-core/package.json` | Modified | `+@ftth-copilot/evidence: workspace:*` |
| `packages/agent-core/tests/runtime.test.ts` | Modified | Asserts verdicts length + verbatim LLM payload preservation |
| `packages/shared/src/index.ts` | Modified | `import type { Verdict } from …`; `AgentResult.verdicts?: Verdict[]` (optional, additive) |
| `packages/shared/package.json` | Modified | `+@ftth-copilot/evidence: workspace:*` as `peerDependencies` (optional) |
| `openspec/config.yaml` | Modified | New `packages/evidence` project entry |

## Coherence Adjustments (documented, not blocking)

1. **`packages/shared` declares `@ftth-copilot/evidence` as `peerDependencies` + `peerDependenciesMeta.optional: true`** instead of the design table's `devDependencies`. The design intent (type-only resolution, no runtime cross-package wiring) is preserved; the swap was required to avoid a fatal pnpm workspace cycle. Documented in `tasks.md` Phase 3.1 note.
2. **`turbo.json` was not modified** — `pnpm-workspace.yaml` auto-discovers `packages/evidence`. Functional but less explicit than the original design expectation. Worth a contributor-facing comment in a future Fase C cleanup pass.

## Final-State Facts

- Apply: 12/12 tasks, 11 commits on `feat/fase-b-truth-gate` (`f35917a chore(sdd): mark fase-b-truth-gate tasks complete` is HEAD)
- Verify: PASS — all green, no warnings requiring later fix
- Tests reported are the final counts from the latest `turbo run test --force` (414 passed), not an intermediate snapshot

## Forward Note for Fase C (strict mode / abstention)

The Fase B gate is **observe-only**: verdicts are attached to `AgentResult.verdicts[]` but the LLM still receives every tool result verbatim. Fase C should:

1. **Flip the data-flow gate** — instead of always appending `result` to `toolResultLines`, branch on `verdict.code`:
   - `ok` → pass through unchanged (current behavior).
   - `stale` / `low_confidence` → either (a) inject a system-side annotation into the LLM payload **or** (b) drop the result and surface an abstention. Decide between "annotate" vs "drop+abstain" based on Fase B calibration data.
   - `incomplete` → **always drop + abstain**; this is the highest-severity verdict.
2. **Surface abstentions** — extend `AgentResult` with an `abstained?: boolean` (or similar) so the chat route can render a "the agent refused on low-confidence evidence" message rather than a fabricated answer.
3. **Persist verdict stream** — if calibration data is wanted, mirror `AgentResult.verdicts[]` to telemetry so Fase B vs Fase C behavior can be compared.
4. **Recommended tag** — add a `// Fase C: flip observe → strict mode here` marker next to the verdict accumulator in `packages/agent-core/src/runtime.ts` (verify-report suggestion #3) to make the entry point obvious for future maintainers.
5. **Re-tune thresholds** — Fase B's `confidence < 0.3` and `now > observedAt + ttlMs` are initial conservative defaults. Fase C should re-evaluate using real distribution data from Fase B's `verdicts[]`.

No design changes are required to the `Verdict` type itself; it already carries `code`, `reason`, `severity`, and `toolName` for correlation with `toolCalls[]`.

## SDD Cycle Complete

The change has been fully planned, designed, specified, implemented, verified, and archived.
Ready for the next change.

## Mechanical Copy Readback (audit trail)

```text
# truth-gate-classification promotion (Step 2)
$ diff -r openspec/changes/fase-b-truth-gate/specs/truth-gate-classification/spec.md \
          openspec/specs/truth-gate-classification/spec.md
(empty — byte-identical)

# change folder archive move (Step 3)
$ diff -r <snapshot_root>/source openspec/changes/archive/2026-09-03-fase-b-truth-gate
(empty — byte-identical)

# evidence-provenance merge (Step 2 — additive, not byte-identical by design)
Source:  openspec/changes/fase-b-truth-gate/specs/evidence-provenance/spec.md  (35 lines)
Target:  openspec/specs/evidence-provenance/spec.md                            (217 lines, +13 vs. Fase A)
Merge:   "Threading de tenantId" requirement body: +1 paragraph (verdicts clause)
         + 2 new scenarios appended (Verdicts attached, Missing verdicts BC)
         All other Fase A requirements/scenarios preserved verbatim.
```