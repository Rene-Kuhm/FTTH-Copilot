# Archive Report: Fase F — Permanent Evaluation + Injection Defense

**Change**: fase-f-eval-injection
**Closed**: 2026-09-04
**Branch**: `feat/fase-f-eval-injection-f8`
**Worktree**: `/home/tecnodespegue/FTTH-Copilot-fase-f8`

## Objective

Deliver a permanent, keyless evaluation harness in CI that exercises the agent core against an adversarial corpus (7 mapped untrusted-input surfaces), asserts no unsupported claim passes, and adds injection-suspicion observability (`warn` tier, `verdict_log` persistence, `__injection_suspicion__` logging). Two-leg architecture: PR leg (keyless, blocking) + nightly leg (MiniMax-M3, metrics-only, observational).

## PRs Merged

| PR | Phase | Description |
|----|-------|-------------|
| #70 | F-1 | `verdict_log` schema + shared zod contracts |
| #71 | F-2 | `packages/eval` skeleton + pink/red corpus fixtures |
| #72 | F-3 | `finalize` consume-warn tier (runtime core) |
| #73 | F-4 | runner + assertions + metrics (corpus-loader, runner, assertions, metrics) |
| #74 | F-5 | chat-route verdict_log writes + `__injection_suspicion__` logging |
| #75 | F-6 | CI `eval` job + nightly workflow |
| #76 | F-7 | labels CSV schema + parser + precision wiring |
| F-8 | this archive | workspace sweep + verify + spec promotion + docs |

## Spec Coverage

| Domain | Requirements | Scenarios | Status |
|--------|-------------|-----------|--------|
| eval-harness | 5 | 11 | All COMPLIANT |
| injection-defense | 4 | 9 | 8 COMPLIANT, 1 WARN (counter derived-nightly, AD-11) |
| strict-mode-abstention | 3 (+ Fase F: 3) | 8 | All COMPLIANT |
| eval-metrics | 5 | 7 | All COMPLIANT |
| evidence-provenance | 1 (+ Fase F: 1) | 3 | All COMPLIANT |
| confirmed-incident-memory | 3 (+ Fase F: 3) | 6 | 4 COMPLIANT, 2 WARN (backfill deferred) |
| **Total** | **21** | **44** | **41 fully COMPLIANT, 3 PARTIAL (documented deferrals)** |

## Test Counts

| Suite | Count | Status |
|-------|-------|--------|
| Unit tests (all 16 packages) | 919 | All pass |
| Eval gate (`@ftth-copilot/eval`) | 113 | All pass (attack-pass-rate == 100%) |
| Build | 2/2 tasks | Clean |
| Lint | 16/16 tasks | Clean |
| Typecheck | 16/16 tasks | Clean |

## Verification

**Verdict**: PASS WITH WARNINGS (no CRITICAL findings, no regressions)
**Verify report**: `openspec/changes/archive/2026-09-04-fase-f-eval-injection/verify-report.md`

## Known Deferrals

| Item | Status | Notes |
|------|--------|-------|
| Precision real numbers via NOC labels | Deferred to Fase 2 | `docs/validation/labels.csv` has header + 0 data rows; `precision: 'TBD'` in metrics report. Task F-7.3 explicitly deferred. |
| Backfill recompute job | Deferred to Fase 2 | Spec uses MAY (AD-7); `verdict_log` table exists and is populated by the chat route for new runs. Historical backfill not in v1 scope. |
| `injection_suspicion_total` counter | Derived-nightly | Design AD-11 chooses a derived metric from `verdict_log` rows (no Prometheus dep). No explicit counter code; derived at nightly from `verdict_log` rows where `code IN ('stale','low_confidence')`. |
| `refuse` gate in corpus | Semantic alias | Red corpus uses `abstain` (which equals refusal). No distinct `refuse` value in red.json; functionally equivalent per AD-3. |

## Archive Reconciliation

- **F-4 task desync**: tasks.md showed F-4.1–F-4.4 as `[ ]` despite code being fully merged on main (PR #73, commit `e2503d1`). Reconciled during this archive — all 4 tasks marked `[x]` per the orchestrator's explicit instruction backed by verify-report proof.
- **F-7.3**: Explicitly deferred (not marked `[x]`); will be addressed in Fase 2 when NOC labels are populated.
- **F-8.1–F-8.4**: Closed by this archive (workspace sweep, verify, spec promotion, docs).

## Canonical Specs Updated

| Domain | Action |
|--------|--------|
| `openspec/specs/eval-harness/spec.md` | Created (new — Fase F only) |
| `openspec/specs/injection-defense/spec.md` | Created (new — Fase F only) |
| `openspec/specs/eval-metrics/spec.md` | Created (new — Fase F only) |
| `openspec/specs/strict-mode-abstention/spec.md` | Appended 3 Fase F requirements + 8 scenarios |
| `openspec/specs/evidence-provenance/spec.md` | Appended 1 Fase F requirement + 3 scenarios |
| `openspec/specs/confirmed-incident-memory/spec.md` | Appended 3 Fase F requirements + 6 scenarios |

## Engram Traceability

- Proposal: `sdd/fase-f-eval-injection/proposal` (observation read)
- Design: `sdd/fase-f-eval-injection/design` (observation read)
- Tasks: `sdd/fase-f-eval-injection/tasks` (observation read)
- Verify report: `sdd/fase-f-eval-injection/verify-report` (observation 133)
- This archive report: `sdd/fase-f-eval-injection/archive-report` (this observation)
