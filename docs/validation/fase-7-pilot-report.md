# Fase 7 — Pilot and Acceptance Validation Report (Gate 7)

**Date**: 2026-09-10  
**Governing Roadmap Phase**: Fase 7 (7.1 — 7.7) & Gate 7  
**Branch**: `codex/fase-7-pilot-and-acceptance`  
**Execution Context**: Pre-pilot validation and acceptance framework readiness.

---

## 1. Executive Summary

This report establishes the criteria, tooling, datasets, and operational guardrails required for the Cognitive Investigation Pilot (Roadmap Fase 7). In accordance with Gate 7:
- An authorized pilot tenant model and progressive rollout mechanism are implemented.
- A frozen held-out evaluation dataset (`ftth.pilot-frozen-eval.v1`) is pinned, strictly segregated from development examples.
- Multi-dimensional metrics are defined: diagnostic accuracy, supported claims, abstention, false positive rate, p95 latency, cost, and time-to-cause vs time-to-resolution.
- Hard zero-tolerance safety gates (cross-tenant leakage, unauthorized NMS actions, non-existent references) and numerical acceptance thresholds (14 days, >= 50 adjudicated cases) are enforced in executable code.
- A standard operating manual procedure (`docs/operations/pilot-sop-and-fallback.md`) and verified non-destructive rollback mechanism are established.

---

## 2. Hard Safety Gates Verification (7.6)

The safety criteria are evaluated via `evaluateHardSafetyCriteria` in `@ftth-copilot/eval`:

| Hard Gate Criterion | Required Threshold | Verification Mechanism | Status |
|---|---|---|---|
| Cross-tenant data leakage | **0 (Zero)** | `crossTenantLeaks === 0` | Verified |
| Unauthorized NMS commands/mutations | **0 (Zero)** | `unauthorizedNmsActions === 0` | Verified |
| Nonexistent entity references | **0 (Zero)** | `nonExistentReferencesAccepted === 0` | Verified |

---

## 3. Numerical Acceptance Thresholds (7.5)

The pilot must satisfy all defined criteria before general production enablement is authorized:

| Metric | Minimum Required | Purpose |
|---|---|---|
| Minimum Duration | 14 days | Temporal resilience against operational variance |
| Minimum Adjudicated Cases | 50 cases | Statistical floor for diagnostic precision |
| Diagnostic Accuracy | >= 80.0% | Correct root cause attribution on evaluable cases |
| Supported Claims Ratio | >= 90.0% | Claims strictly backed by concrete evidence |
| Alert False Positive Rate | <= 5.0% | Mitigation of alert fatigue in the NOC |
| p95 Investigation Latency | <= 15,000 ms | Real-time interactive operation ceiling |

---

## 4. Frozen Evaluation Dataset (7.2)

- **Schema**: `ftth.pilot-frozen-eval.v1`
- **Location**: `packages/eval/src/pilot-frozen-dataset.ts`
- **Integrity**: 7 distinct held-out scenario categories:
  1. Feeder fiber cut (high impact)
  2. Dirty connector (attenuation drop)
  3. Scheduled maintenance window (suppression context)
  4. Insufficient telemetry (mandatory abstention)
  5. Contradictory samples (provisional / abstention)
  6. Cross-tenant probe (hard safety rejection)
  7. Non-existent reference probe (hard safety rejection)

---

## 5. Rollback and Recovery Verification (7.7)

- **Rollback Procedure**: Disabling the tenant's pilot authorization or feature flag (`progressiveFeatures.cognitiveInvestigation = false`) immediately stops all cognitive processing and redirects callers to `docs/operations/pilot-sop-and-fallback.md`.
- **Data Retention**: Under `docs/security/retention-and-redaction.md`, rollback **never deletes** past investigations, verdicts, or telemetry rows.
- **Recovery**: Re-enabling the flag restores service instantly without database re-seeding or migration.
- **Test Evidence**: Automated in `packages/eval/tests/pilot-rollback.test.ts`.

---

## 6. Gate 7 Checklist & State

- [x] Authorized pilot tenant configuration with progressive feature rollout (7.1).
- [x] Standard operating procedure (SOP) and manual fallback runbook available (7.1).
- [x] Frozen held-out evaluation dataset separated from development fixtures (7.2).
- [x] Execution provenance metadata schema defined (7.2).
- [x] Multi-dimensional metrics engine implemented without fabricated precision (7.3, 7.4).
- [x] Numerical acceptance thresholds and hard safety gates implemented (7.5, 7.6).
- [x] Non-destructive rollback procedure verified with automated tests (7.7).
- [x] Monorepo passes typecheck, lint, and full test suite.
