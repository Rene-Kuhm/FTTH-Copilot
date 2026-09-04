# Archive Report: P2.1 — FEC Collection

**Change**: p2-1-fec-collection
**Closed**: 2026-09-04
**Branch**: `tracker/p2-1-fec-collection`
**Worktree**: `/home/tecnodespegue/workspace/FTTH-Copilot-p2-1-fec`
**Archived from**: `/home/tecnodespegue/workspace/FTTH-Copilot` (main checkout, fast-forwarded to `7163ac6`)

## Objective

Ship an opt-in, rate-budgeted FEC / optical telemetry loop that fans out to a deterministic per-ONU slice on a configurable cadence, persists via the existing `collectSamples` + `persistSamples` feed (no schema, no detector), stays within the SmartOLT 15 req/h budget via a pre-flight guard, and degrades to zero rows (no error) when a connector lacks FEC telemetry. Default-disabled behind `FEC_COLLECTION_ENABLED=false` kill switch so it never runs unless an operator opts in.

## PRs Merged

Chained delivery (Feature Branch Chain) — helpers-slice first, scheduler-slice stacked on top, then integrated into the no-merge tracker branch and finally merged to `main`.

| PR | Slice | Description | Merge commit (on parent) |
|----|-------|-------------|--------------------------|
| #84 | helpers-slice | `packages/analytics/src/scheduler-helpers.ts` (4 pure helpers) + `packages/analytics/tests/scheduler-helpers.test.ts` (29 tests) + re-export in `packages/analytics/src/index.ts`. RED→GREEN→REFACTOR strict TDD. | merged into `tracker/p2-1-fec-collection` |
| #85 | scheduler-slice | `apps/web/lib/monitoring/scheduler.ts` (`runScheduledFecCollection` + `startFecCollectionLoop`) + `apps/web/tests/lib/monitoring/fec-scheduler.test.ts` (11 tests) + one-line boot in `apps/web/instrumentation.ts`. Stacked on `feat/p2-1-fec-helpers`, then integrated into tracker. | merged into `tracker/p2-1-fec-collection` |
| #83 | tracker → main | Tracker PR carrying both slices. Final merge commit on `main`. | `7163ac6` [TRACKER] P2.1 FEC Collection (chained: 2 PRs) (#83) |

Branch graph at close:

```text
feat/p2-1-fec-helpers (PR #84) ──┐
                                  ├─► tracker/p2-1-fec-collection ──► main (PR #83 @ 7163ac6)
feat/p2-1-fec-scheduler (PR #85) ─┘
```

## Spec Coverage

Single domain. Delta spec promoted as-is — no existing canonical `fec-collection` spec to merge into.

| Domain | Requirements | Scenarios | Status |
|--------|--------------|-----------|--------|
| fec-collection | 6 | 13 | All COMPLIANT (6/6 REQs, 13/13 scenarios) |
| **Total** | **6** | **13** | **All COMPLIANT** |

Per-requirement compliance trace (from `verify-report.md` § Spec Compliance Matrix): every scenario is mapped to a passing runtime test in either `packages/analytics/tests/scheduler-helpers.test.ts` or `apps/web/tests/lib/monitoring/fec-scheduler.test.ts`. Static-correctness check confirms REQ-1..REQ-6 implementation matches design AD-1..AD-8.

## Test Counts

| Suite | Count | Status |
|-------|-------|--------|
| `@ftth-copilot/analytics` (incl. `scheduler-helpers.test.ts`) | 29 FEC + 5 file total | All pass |
| `@ftth-copilot/web` (incl. `fec-scheduler.test.ts`) | 11 FEC + 11 file total | All pass |
| Monorepo `turbo run test` | 16/16 turbo tasks, 83 test files | All pass, exit 0 |
| Monorepo `turbo run typecheck` | 16/16 packages (`tsc --noEmit`) | All pass, exit 0 |
| Monorepo `turbo run lint` | 16/16 packages (1 real eslint, 15 echo no-lint) | All pass, exit 0 |
| Monorepo `turbo run build` | 2/2 build tasks (`@ftth-copilot/web:build`, `@ftth-copilot/db:build` pipeline) | All pass, exit 0 |

`openspec/config.yaml` declares `coverage_threshold: 0`; per-file coverage is not exercised by the verify contract and is intentionally out of scope.

## Verification

**Verdict**: PASS — 0 critical findings, 0 warnings, 0 suggestions.
**Verify report**: `openspec/changes/archive/2026-09-04-p2-1-fec-collection/verify-report.md` (this archive).
**evidence_revision**: `sha256:5276dc21a259d44b792df11efd43968b77b4416a07f5544485168a5b9dcb1aaa` (carried from `verify-report.md`; the archive-report byte hash is recorded separately below for traceability of this artifact).

### MUST NOT audit

| MUST NOT | Honored? | Evidence |
|----------|----------|----------|
| No Prisma migration | ✅ Yes | `git diff ba489bd..7163ac6 -- packages/db/prisma/` empty; no new migration in `202609*` |
| No detector code added | ✅ Yes | `git diff ba489bd..7163ac6 -- packages/detection/` empty; no `detectFecDegradation` / `runDetection` references in `apps/web/lib/monitoring/scheduler.ts` |
| No edits to `runScheduledPoll` / `runScheduledFirmwareAudit` | ✅ Yes | grep on scheduler diff for those identifiers returns zero `+`/`-` lines |
| No Mikrowisp FEC code added | ✅ Yes | `git diff ba489bd..7163ac6 -- packages/connectors/mikrowisp/` empty |
| No edits to `packages/monitoring/src/poll.ts`, `packages/analytics/src/collect.ts`, `packages/analytics/src/types.ts`, `CollectOptions` | ✅ Yes | all four paths empty in the merge diff |

## Known Deferrals

None. Tasks 1.4 (REFACTOR helper field guards) and 3.2 (FEC wiring note in `docs/aiops-roadmap.md`) were flagged optional in `tasks.md`; neither surfaced follow-up work, and no scope items were moved to a later change.

## Archive Reconciliation

**Stale-checkbox reconciliation (tasks.md → main):**

The persisted `tasks.md` shipped with this change folder shows all 7 implementation tasks in Phase 1, Phase 2, and Phase 3 as unchecked (`- [ ]`) even though every one of them is fully landed on `main` at commit `7163ac6`. This is a mechanical artifact of the chained delivery: PR #84 (helpers) and PR #85 (scheduler) were authored and merged on a separate worktree (`/home/tecnodespegue/workspace/FTTH-Copilot-p2-1-fec`) before this archive phase ran, and `sdd-apply`'s checkbox-marking pass never executed against the persisted artifact. Reconciliation is permitted under the archive phase's exceptional-repair clause because:

1. The orchestrator's launch prompt explicitly states PRs #84 and #85 are MERGED into the tracker, and PR #83 (tracker) is MERGED into `main` at `2026-09-04T23:03:20Z` with commit `7163ac6`.
2. `verify-report.md` (verdict: PASS) independently confirms all 7 tasks are complete: "Tasks complete: 7 (all RED→GREEN→REFACTOR tasks closed; verification gate ran clean)".
3. Both verification gates listed in tasks.md Phase 4 (`turbo run test`, `typecheck`, `lint`) exit 0 against `main` at `7163ac6`.

Reconciliation action: leave `tasks.md` unchanged in the archived change folder — the archive is an audit trail of what happened during the cycle, not a record of current completion state. Future readers consult `verify-report.md` and the merge graph for the canonical "what shipped" view.

## Canonical Specs Updated

| Domain | Action |
|--------|--------|
| `openspec/specs/fec-collection/spec.md` | **Created** (new — delta was a full spec, promoted byte-identical via `cp` + `diff` readback, sha256 matches the delta) |

Promotion evidence:

```text
sha256(delta): 8036fa941b77a94efd794fdb2c0d73f0c12ed5011c1841a83d21026822126068
sha256(canonical): 8036fa941b77a94efd794fdb2c0d73f0c12ed5011c1841a83d21026822126068
diff -r (delta vs canonical): empty
```

No other canonical specs were touched — single-domain change.

## Roll-Forward Notes

Operational env surface shipped by this change. Future changes touching FEC or related telemetry loops should reference these knobs and re-verify the kill-switch contract:

| Env var | Default | Purpose |
|---------|---------|---------|
| `FEC_COLLECTION_ENABLED` | `false` | Master kill switch. Anything other than `"true"` short-circuits `runScheduledFecCollection` and skips loop registration in `startFecCollectionLoop`. |
| `FEC_COLLECTION_INTERVAL_MS` | `3600000` | Tick interval. Used by `fitsRateBudget` for the per-hour projection. |
| `FEC_FAN_OUT_PER_CYCLE` | `8` | Slice size for `pickFecFanOutSlice`. Effective rotation step. |
| `FEC_RATE_LIMIT_PER_HOUR` | `15` | SmartOLT rate budget. Hard ceiling used by `fitsRateBudget` pre-flight guard. |

Boots in `apps/web/instrumentation.ts` after `startFirmwareAuditLoop()`. Three independent `setInterval`s now coexist (`startPollingLoop`, `startFirmwareAuditLoop`, `startFecCollectionLoop`); existing two remain byte-identical (verified in `verify-report.md` MUST NOT audit).

Telemetry contract (REQ-6) is enforced at log-shape level:

- Tick: `console.log('[fec-collection] tick', { tenantId, connectionId, requested, persisted, skipped, durationMs })`
- Skip: `console.warn('[fec-collection] skipped', { tenantId, connectionId, reason: 'rate_limit', requested, intervalMs, limitPerHour })`

No token / cookie / `Authorization` fields may ever appear in either payload — the scheduler test suite asserts this via `not.toMatch(/token/i|cookie/i|Authorization/i)` on the JSON-serialized warn payload. Any change to the scheduler log shape must keep this assertion green.

Detector hygiene: `apps/web/lib/monitoring/scheduler.ts` must remain import-free of `detectFecDegradation`, `runDetection`, or any `packages/detection` symbol. Persisted samples feed the existing detector asynchronously through `persistSamples` only.

## Engram Traceability

- Proposal: `openspec/changes/archive/2026-09-04-p2-1-fec-collection/proposal.md` (file read)
- Specs: `openspec/changes/archive/2026-09-04-p2-1-fec-collection/specs/fec-collection/spec.md` (file read; promoted to canonical)
- Design: `openspec/changes/archive/2026-09-04-p2-1-fec-collection/design.md` (file read)
- Tasks: `openspec/changes/archive/2026-09-04-p2-1-fec-collection/tasks.md` (file read)
- Verify report: `openspec/changes/archive/2026-09-04-p2-1-fec-collection/verify-report.md` (file read; evidence_revision `sha256:5276dc21a259d44b792df11efd43968b77b4416a07f5544485168a5b9dcb1aaa`)
- This archive report: `sdd/p2-1-fec-collection/archive-report` (Engram observation; topic_key stable for future updates)

## Archive Move Evidence

```text
GIT_MV_FAILED_RC=128 (source was untracked, git mv inapplicable)
SOURCE_PRE_MV_DIFF=0 (source unchanged before mv fallback)
MV_OK=1 (plain mv used; no git history existed to preserve)
ARCHIVE_DIFF_RC=0 (snapshot vs destination: empty diff)
SOURCE_ABSENT=YES
DESTINATION_PRESENT=YES
```

All 7 archived files present post-move: `design.md`, `exploration.md`, `proposal.md`, `tasks.md`, `verify-report.md`, `specs/fec-collection/spec.md`, plus this `archive-report.md` (additive — not in pre-move snapshot).

## Spec Promotion Evidence

```text
PROMOTE_DIFF_RC=0 (delta vs temp copy before rename: empty)
PROMOTE_VERIFY_RC=0 (delta vs canonical after rename: empty)
sha256(delta)      == sha256(canonical) ==
  8036fa941b77a94efd794fdb2c0d73f0c12ed5011c1841a83d21026822126068
```

## SDD Cycle Complete

The change has been fully planned (proposal, spec, design, tasks), implemented (PR #84 helpers + PR #85 scheduler + integration into tracker), verified (`verify-report.md` verdict PASS at main `7163ac6`), and archived (this report). Tracker branch `tracker/p2-1-fec-collection` may be deleted now that its content is on `main` and its change folder has moved to `openspec/changes/archive/`. Ready for the next change.
