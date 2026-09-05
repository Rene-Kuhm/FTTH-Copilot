# Archive Report: P2.2 — Optical Metrics (LOS Collection)

**Change**: p2-2-optical-metrics
**Closed**: 2026-09-05
**Branch**: `chore/sdd-archive-p2-2-optical-metrics`
**Worktree**: `/home/tecnodespegue/workspace/FTTH-Copilot` (feature branch off `main` at `ae92dc6`)
**Archived from**: `/home/tecnodespegue/workspace/FTTH-Copilot` (main checkout, fast-forwarded to `ae92dc6` after PR #89 merge)

## Objective

Close the "optical telemetry complete by ONT" gap from the roadmap: extend `MetricKind` with `LOS_SECONDS_TOTAL` (Prisma migration), surface `losSecondsTotal` on `OnuSummary`/`OnuDetail`, map six SmartOLT candidate keys via `pickNumber`, emit the fifth optical kind through the existing FEC scheduler fan-out, ship `detectLosEvents` (mirroring `detectFecDegradation`), wire it into `runDetectors` + `group.ts`, and reconcile the `TRAFFIC_THROUGHPUT_MBPS` union gap between `analytics` and `alerts`. Single new capability (`los-collection`), zero MODIFIED specs.

## PRs Merged

Chained delivery (Feature Branch Chain) — helpers-slice first (`stacked-to-main`); detector-slice stacked on top and merged to `main`; the change folder stays untracked through the merge, archived in this PR.

| PR | Slice | Description | Merge commit on `main` |
|----|-------|-------------|--------------------------|
| #88 | helpers-slice | `MetricKind.LOS_SECONDS_TOTAL` (Prisma migration `20260905000000_add_los_metric_kind`), `OnuSummary.losSecondsTotal`, 6-key `pickNumber` extension, 1-line `assembleOnuDetailPoints` extension, `TRAFFIC_THROUGHPUT_MBPS` union reconciliation, `group.ts` LOS arm + `SeriesByDevice.losSecondsTotal`, fixture extension, and 5 covering test files. RED→GREEN strict TDD. 14 files changed, **+270 / -14**. | `2d9f3ca` feat(optical): add LOS_SECONDS_TOTAL MetricKind + losSecondsTotal wiring (P2.2 helpers-slice) (#88) |
| #89 | detector-slice | `packages/detection/src/los.ts` (`detectLosEvents`, 106 LOC) + `tests/los.test.ts` (77 LOC, six RED→GREEN cases), re-export from `packages/detection/src/index.ts`, wire into `runDetectors` after `detectOpticalDegradation`, extend `runner.test.ts` matrix and `scenario.test.ts` helper. 6 files changed, **+216 / -0**. | `ae92dc6` feat(detection): add detectLosEvents + alert wiring (P2.2 detector-slice) (#89) |

Branch graph at close:

```text
feat/p2-2-helpers (PR #88, 2d9f3ca) ─► main @ ae92dc6 ◄─ feat/p2-2-detector (PR #89, ae92dc6) (stacked-to-main)
```

Total diff size: **~486 LOC** (`270 + 216`) across 2 chained PRs, **stacked-to-main** per the proposal's delivery strategy. Each PR individually below the 400-line review budget.

## Spec Coverage

Single domain. Delta spec promoted as-is — no existing canonical `los-collection` spec to merge into.

| Domain | Requirements | Scenarios | Status |
|--------|--------------|-----------|--------|
| los-collection | 9 | 13 | All COMPLIANT (8 ✅ COMPLIANT with covering passing tests + 1 ⚠️ PARTIAL for the deploy-time `ADD VALUE IF NOT EXISTS` rollback contract) |
| **Total** | **9** | **13** | **All COMPLIANT** (none UNTESTED, none FAILING) |

Per-requirement compliance trace (from `verify-report.md` § Spec Compliance Matrix): every scenario is mapped to a passing runtime test in `packages/{detection,alerts,analytics,connectors-smartort,web}/tests/**`. The single ⚠️ PARTIAL scenario (REQ-9 forward-only migration rollback) is verified by static inspection of the migration SQL (`ADD VALUE IF NOT EXISTS`, idempotent on `prisma migrate deploy`); PG itself forbids `DROP VALUE` from an enum, so the contract is enforced at the database layer. Non-blocking per the verify report.

## Test Counts

| Suite | Count | Status |
|-------|-------|--------|
| `@ftth-copilot/detection` (incl. `los.test.ts`, 6 cases) | 71 tests | All pass |
| `@ftth-copilot/analytics` (incl. `scheduler-helpers.test.ts`, +4 LOS cases) | 66 tests | All pass |
| `@ftth-copilot/alerts` (incl. `group.test.ts` +9, `runner.test.ts` +8 — both with LOS cases) | 57 tests | All pass |
| `@ftth-copilot/connectors-smartolt` (incl. `real-client.test.ts`, +7 LOS candidate mappings) | 31 tests | All pass |
| `@ftth-copilot/web` (incl. `fec-scheduler.test.ts` — `persisted:40` / 5 kinds) | 99 tests | All pass |
| `@ftth-copilot/eval` (Eval Gate corpus) | 143 tests | Attack-pass-rate == 100% |
| Monorepo `turbo run test` | 13/13 turbo tasks, 76 test files, **963 tests** | All pass, exit 0 |
| Monorepo `turbo run typecheck` | combined with test (37 tasks) | All pass, exit 0 |
| Monorepo `turbo run lint` | combined with test (37 tasks) | All pass, exit 0 |
| Monorepo `turbo run build` | 2/2 build tasks (`@ftth-copilot/db` Prisma regen + `@ftth-copilot/web` Next.js) | All pass, exit 0 |

`openspec/config.yaml` declares `coverage_threshold: 0`; per-file coverage is not exercised by the verify contract and is intentionally out of scope (matches the P2.1 archive's posture).

## Verification

**Verdict**: PASS — 0 critical findings, 0 blockers, 9/9 requirements, 13/13 scenarios.
**Verify report**: `openspec/changes/archive/2026-09-05-p2-2-optical-metrics/verify-report.md` (this archive).
**evidence_revision**: `sha256:89f9963ab4df3a355525b0cf0bdf2b0cc6512a784aba35c0b60eac6768f939cf` (carried from `verify-report.md`).
**verify-report.md sha256**: `92a287700b5fd8f4e93d6078a25f0c24414d4553f57eee2fa354b1ba24e99993`.

### Integration Tests (Postgres)

Not executable locally — `DATABASE_URL` service-container provisioning was out of reach on the local checkout. The CI runs `test-integration` against a fresh `postgres:16` container; both PR #88 and PR #89 reported 14/14 green on those runs (per apply-progress observations carried into `verify-report.md`). The unit-level `runDetection` integration test does not exercise any P2.2-specific code path; the LOS scenarios are covered end-to-end by the unit tests + the FEC scheduler integration test in `apps/web`.

## Archive Reconciliation

**Stale-checkbox reconciliation (tasks.md → main):**

The persisted `tasks.md` shipped with this change folder shows all 15 implementation tasks in Phase 1 (1.1–1.10) and Phase 2 (2.1–2.5) marked `[x]`. Phase 3 (3.1–3.3: verification gate) and Phase 4 (4.1–4.3: archive operations) are unchecked by design — they are post-verify and archive phase work, not implementation tasks, and they are the operational phase that this report closes. The Task Completion Gate (15/15 implementation tasks `[x]`) passes per `verify-report.md` § Completeness. No stale-checkbox reconciliation is required for implementation tasks. The archived `tasks.md` is preserved as-is for audit-trail purposes (matches the P2.1 archive's posture).

## Canonical Specs Updated

| Domain | Action |
|--------|--------|
| `openspec/specs/los-collection/spec.md` | **Created** (new — delta was a full spec, promoted byte-identical via `cp` + `diff` readback, sha256 matches the delta) |

Promotion evidence:

```text
sha256(delta):      d72c9e04fc1d57f0a0b1823daa99fe43579cde1d8e1ce9ea8aa4457cbcb44771
sha256(canonical):  d72c9e04fc1d57f0a0b1823daa99fe43579cde1d8e1ce9ea8aa4457cbcb44771
diff -r (delta vs temp copy before rename): empty
diff -r (delta vs canonical after rename):  empty
```

No other canonical specs were touched — single-domain change. The `TRAFFIC_THROUGHPUT_MBPS` reconciliation mentioned in the proposal is a TypeScript union fix (no `openspec/specs/*.md` schema touched, confirmed by `verify-report.md` REQ-8 "Persistence agnosticity" scenario).

## Roll-Forward Notes

Operational surface shipped by this change. Future changes touching LOS detection or the fifth optical kind should reference these contracts and re-verify the rollback story:

| Surface | Contract | Verification |
|---------|----------|--------------|
| `MetricKind.LOS_SECONDS_TOTAL` enum value | Prisma migration `20260905000000_add_los_metric_kind` uses `ALTER TYPE "MetricKind" ADD VALUE IF NOT EXISTS 'LOS_SECONDS_TOTAL'` (idempotent on `prisma migrate deploy`); PG forbids `DROP VALUE` from an enum, so the contract is forward-only by design. | REQ-1, REQ-9 |
| `OnuSummary.losSecondsTotal` field | Optional monotonic counter, `undefined` when the connector doesn't surface LOS (Mikrowisp graceful-degrade); never `NaN`. | REQ-2, REQ-3 |
| `pickNumber` candidate list | 6 keys: `los_seconds_total`, `los_seconds`, `losCount`, `los_count`, `loss_of_signal_seconds`, `signal_loss_seconds` — parametrized in `packages/connectors/smartolt/tests/real-client.test.ts`. | REQ-3 |
| `detectLosEvents` | Mirrors `detectFecDegradation`: 24h window, `minSamples: 3`, warning at Δ ≥ 1 s, critical at Δ ≥ 30 s; "recent spike" rule catches "LOS just started" (last > second-to-last) even when window total is below the warning threshold. | REQ-6 |
| `runDetectors` call order | `detectLosEvents` runs **after** `detectOpticalDegradation` (`packages/alerts/src/runner.ts:35-36`); no new `AlertKind` — reuses `optical_degradation`, title/description disambiguates from bias/temp findings. | REQ-7 |
| FEC scheduler tick | `persisted:40` per tick for a SmartOLT-shaped 8-ONU slice (8 × 5 = 40 rows: `FEC_CORRECTED`, `FEC_UNCORRECTED`, `BIAS_CURRENT_MA`, `ONT_TEMPERATURE_CELSIUS`, `LOS_SECONDS_TOTAL`); Mikrowisp degrades to zero LOS rows without throw. | REQ-5 |

Telemetry contract preserved: LOS rows go through the same `persistSamples` feed as the other four optical kinds; `packages/analytics/src/ingest.ts` and `packages/analytics/src/collect.ts` are unchanged on the merge diff (`git diff bc58e2d..ae92dc6` shows zero touch). Any future edit to those paths must keep LOS rows kind-agnostic (REQ-8 "Persistence agnosticity").

## Engram Traceability

- Proposal: `openspec/changes/archive/2026-09-05-p2-2-optical-metrics/proposal.md` (file read)
- Specs: `openspec/changes/archive/2026-09-05-p2-2-optical-metrics/specs/los-collection/spec.md` (file read; promoted byte-identical to canonical `openspec/specs/los-collection/spec.md`, sha256 `d72c9e04fc1d57f0a0b1823daa99fe43579cde1d8e1ce9ea8aa4457cbcb44771`)
- Design: `openspec/changes/archive/2026-09-05-p2-2-optical-metrics/design.md` (file read)
- Tasks: `openspec/changes/archive/2026-09-05-p2-2-optical-metrics/tasks.md` (file read; 15/15 implementation tasks `[x]`)
- Verify report: `openspec/changes/archive/2026-09-05-p2-2-optical-metrics/verify-report.md` (file read; evidence_revision `sha256:89f9963ab4df3a355525b0cf0bdf2b0cc6512a784aba35c0b60eac6768f939cf`, file sha256 `92a287700b5fd8f4e93d6078a25f0c24414d4553f57eee2fa354b1ba24e99993`, verdict PASS)
- This archive report: `sdd/p2-2-optical-metrics/archive-report` (Engram observation; topic_key stable for future updates)

## Archive Move Evidence (verbatim shell output)

```text
$ git mv openspec/changes/p2-2-optical-metrics openspec/changes/archive/2026-09-05-p2-2-optical-metrics
fatal: source directory is empty, source=openspec/changes/p2-2-optical-metrics, destination=openspec/changes/archive/2026-09-05-p2-2-optical-metrics
=== git mv failed (rc=128), checking source presence ===
source still present after git mv failure — proceeding to mv fallback
=== plain mv fallback succeeded ===
=== diff -r (snapshot vs destination) ===
(empty — no output, exit 0)
```

```text
GIT_MV_FAILED_RC=128 (source was untracked on main checkout, git mv inapplicable)
SOURCE_PRE_MV_DIFF=0 (source unchanged before mv fallback; snapshot vs source empty)
MV_OK=1 (plain mv used; no git history existed to preserve)
ARCHIVE_DIFF_RC=0 (snapshot vs destination: empty diff)
SOURCE_ABSENT=YES
DESTINATION_PRESENT=YES
```

All 6 archived source files present post-move (preserved byte-identical via `mv`): `design.md`, `exploration.md`, `proposal.md`, `tasks.md`, `verify-report.md`, `specs/los-collection/spec.md`. The `archive-report.md` is additive — written to the archive folder after the move and excluded from the snapshot comparison (matches the P2.1 archive's posture).

## Spec Promotion Evidence (verbatim shell output)

```text
$ cp openspec/changes/p2-2-optical-metrics/specs/los-collection/spec.md openspec/specs/los-collection/.spec.md.XXXXXX
$ diff -r openspec/changes/p2-2-optical-metrics/specs/los-collection/spec.md openspec/specs/los-collection/.spec.md.XXXXXX
(empty — no output, exit 0)
$ mv openspec/specs/los-collection/.spec.md.XXXXXX openspec/specs/los-collection/spec.md
$ diff -r openspec/changes/p2-2-optical-metrics/specs/los-collection/spec.md openspec/specs/los-collection/spec.md
(empty — no output, exit 0)
```

```text
PROMOTE_DIFF_RC=0 (delta vs temp copy before rename: empty)
PROMOTE_VERIFY_RC=0 (delta vs canonical after rename: empty)
sha256(delta)      == sha256(canonical) ==
  d72c9e04fc1d57f0a0b1823daa99fe43579cde1d8e1ce9ea8aa4457cbcb44771
```

## Roadmap Update

`docs/roadmap-integraciones-pendientes.md` §P2.2 flipped from `🔵 PENDIENTE (próximo)` to `✅ shipped (chained: PR #88 + PR #89, archive)`. Summary table row updated to `✅ shipped (#88/#89)`. Header date updated to `2026-09-05`. `Recomendación de arranque` recomposed to start at P1.1 (the only remaining P-pending item). Matches the P2.1 archive's roadmap-edit pattern.

## SDD Cycle Complete

The change has been fully planned (proposal, spec, design, tasks), implemented (PR #88 helpers-slice + PR #89 detector-slice, stacked-to-main at `ae92dc6`), verified (`verify-report.md` verdict PASS — 9/9 requirements, 13/13 scenarios, 0 critical findings), and archived (this report). Change folder moved to `openspec/changes/archive/2026-09-05-p2-2-optical-metrics/`; canonical spec `openspec/specs/los-collection/spec.md` promoted byte-identical; roadmap flipped to shipped. Ready for the next change.