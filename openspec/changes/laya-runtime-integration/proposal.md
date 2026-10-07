# Laya Runtime Integration — Proposal

**Change**: `laya-runtime-integration`
**Date**: 2026-10-07
**Base commit**: `6b34a48` (branch `feat/laya-runtime-integration`)
**Strict TDD**: true

---

## Why

ADR-042 declares the Laya Decision Layer as `Estado: Implementado`. A runtime audit at
`main@6b34a48` shows the layer is built, tested and documented but **not reachable from the
running product**: the decision is produced, and the metrics surface is published, but nothing
connects the two.

Measured facts:

- `packages/agent-core/src/adaptive-router.ts:361-370` classifies **every** routed query with the
  expert system and writes `eventClass` / `eventConfidence` into `DiagnosticRoute`.
- `apps/web/lib/metrics/prometheus.ts:3,313` already appends the `ftth_laya_*` family via
  `layaMetrics.toPrometheusFormat()`.
- No module writes to `layaMetrics`. Its only writer, `recordLayaDecision`, lives in
  `packages/shared/src/laya-client.ts:240`, which is neither exported from
  `packages/shared/src/index.ts` nor imported by anything outside `packages/shared`.
- Therefore `toPrometheusFormat()` (`laya-metrics.ts:113-156`) emits six `# HELP` / `# TYPE`
  header lines and **zero samples**.

User-visible consequence: `apps/web/app/dashboard/laya/page.tsx` renders
`LayaMetricsPanel`, whose parser (`LayaMetricsPanel.tsx:39`) matches
`^ftth_laya_requests_total\{...}`. It never matches, so the dashboard is permanently stuck on
*"Sin decisiones registradas aún"* and instructs the operator to set `LAYA_ENABLED=true`, which
changes nothing.

This is a one-ended cable, not a missing feature. The fix is to close the circuit and make the
documented modes real.

## What changes

1. **One config truth.** A single exported resolver owns `LAYA_ENABLED` / `LAYA_MODE` /
   `LAYA_FAIL_OPEN` defaulting. Today `laya-shadow.ts:192` reads `LAYA_ENABLED !== 'false'`
   (default **on**) while `laya-client.ts:47` reads `LAYA_ENABLED === 'true'` (default **off**).
2. **Close the circuit.** The orchestration layer records each classification into `layaMetrics`,
   gated by the resolved config. `planRoute` stays pure.
3. **Make the modes real.** `assisted` and `automatic` let the Laya signal influence the route
   through `mergeRoutingDecision`; `shadow` records without changing the route; `disabled` does
   nothing.
4. **Fix the blocking collision.** `recordLayaDecision` is exported twice with incompatible
   signatures (`laya-metrics.ts:169` vs `laya-client.ts:240`). Exporting `laya-client` without
   resolving this raises TS2308.
5. **Observability and cache correctness.** Consume the discarded circuit-breaker `opened` value,
   validate inbound Laya responses against the already-imported `layaDecisionSchema`, and declare
   the `LAYA_*` vars in `turbo.json` `globalEnv`.
6. **Deployment and documentation truth.** Ship the `services/laya` service to demo and prod
   compose, de-duplicate and correct `.env.example`, and align ADR-042 / README claims with the
   verified end state.

## Impact

**Surfaces touched**: `packages/shared/src/laya-*.ts`, `packages/shared/src/index.ts`,
`packages/agent-core/src/runtime.ts`, `turbo.json`, `.env.example`,
`docker-compose.demo.yml`, `docker-compose.prod.yml`, `docs/engineering/ADR-042-*.md`, `README.md`.

**Behavioral blast radius**: the agent routing path (`packages/agent-core/src/runtime.ts`). The
recording hook runs on every routed query.

**Not touched**: the expert-system classifier itself, the detection pipeline, the database schema,
auth. No migration.

## Non-goals

- Auditing or re-deriving the advertised 94.4% accuracy figure.
- Rewriting the public narrative beyond stating the verified runtime state.
- Adding a new observability stack; reusing `/api/metrics` and VictoriaMetrics as-is.

## Rollback plan

The change is **feature-flagged by default**: `LAYA_ENABLED` resolves to `false`, so after this
change the recording hook and every mode branch are inert until an operator opts in. Rollback
therefore needs no data migration and no deploy dance.

Per incremented risk:

| Risk | Mitigation | Rollback |
|---|---|---|
| Exporting new symbols from `packages/shared/src/index.ts` surfaces the `recordLayaDecision` collision | Resolve the collision in Phase 3.1 **before** exporting in 3.2; `tsc --noEmit` proves it | Revert `index.ts` to the three `export *` lines; nothing else depends on the new exports |
| Changing `laya-shadow.ts` default from enabled to disabled | Covered by a test asserting identical resolution across both loaders; confirm no live path consumes `getLayaConfig()` before merging | Restore the `!== 'false'` expression for that one field |
| Adding recording to the hot routing path | Synchronous in-memory `Map` increment only, no I/O, no `await`; guarded by `enabled` | Delete the hook call site in `runtime.ts` |
| Adding `laya` to prod compose | `LAYA_ENABLED=false` default means the service is optional and the app never calls it unless opted in; keep it on an opt-in profile | Remove the compose block; prod behavior returns to today's |
| Laya service unreachable in `assisted`/`automatic` | `failOpen` default `true`: the route falls back to the adaptive decision and the failure is recorded | Set `LAYA_MODE=disabled` |

Full rollback of the branch is `git checkout main`, since no commit here is a prerequisite for
any other work.

## Verification

Every task closes with `turbo run <task> --force` evidence (a plain run may be a Turbo cache
`HIT` and therefore proves nothing), plus `pnpm check:sources` and `pnpm check:contribution`.
End-to-end acceptance: with `LAYA_ENABLED=true` and `LAYA_MODE=shadow`, `GET /api/metrics` MUST
contain at least one `ftth_laya_requests_total{...}` sample line.
