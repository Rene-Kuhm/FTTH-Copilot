# Proposal: Fase F — Permanent Evaluation + Injection Defense

## Intent

Keyless PR gate over validated gaps: 7 untrusted inputs with zero filtering, metadata-only TruthGate, unconsumed `warn` tier, memory-only `verdicts`, manual-only `docs/validation/`. Research `blocked`; repo evidence only.

## Scope

### In Scope
- New `packages/eval`: JSON pink/red corpus + vitest runner + metrics + CI threshold job (keyless)
- Attack taxonomy from the 7 mapped surfaces only
- Real-failure corpus from `ConfirmedIncident`; metrics over existing rows
- Abstention contracts as tests; `warn`-tier wiring decision
- Verdict-persistence decision (DB vs log); per-tenant measurement hooks
- Scheduled calibration leg design (keys, off-PR)

### Out of Scope
- pgvector; LLM-judge in PR CI (no keys by design)
- Playwright as gate proof (specs route-mock the agent)
- New topology, retrieval, or remediation behavior; external taxonomies

## Capabilities

### New Capabilities
- `eval-harness`: corpus, mocked-`runAgent` runner, metrics, CI thresholds
- `injection-defense`: pink/red cases per surface; refuse/abstain assertions

### Modified Capabilities
- `strict-mode-abstention`: consume `warn` in `finalize` (`runtime.ts:309-334`)
- `confirmed-incident-memory`: corpus derivation; verdict-log persistence contract

## Approach

Two legs, one gate. PR leg: `packages/eval` via `vi.mock(createLlmClient)` + `withToolResults` (per `runtime.test.ts:13-18`); asserts no unsupported claim passes. Nightly leg: same sets + `ConfirmedIncident` corpus on real models with keys. Metrics — coverage, precision, abstention rate, gate FPs — over `ConfirmedIncident`, `Message.toolCalls` (incl. `__abstention__`), `AgentActionLog`. Tenant split via `TenantPolicy` knobs; Fase E code is ground truth, not checkbox state.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/eval/` | New | Corpus JSON, vitest runner, metrics |
| `packages/agent-core/src/runtime.ts` | Modified | Wire `warn`; verdict emission point |
| `packages/evidence/src/` | Modified | Test contracts only |
| `packages/db/` | Modified | Verdict persistence decision |
| `.github/workflows/ci.yml` | Modified | Keyless threshold job after unit |
| `docs/validation/` | Modified | Manual log becomes corpus seed |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Over-cautious gate (FP abstentions) | Med | Track FP rate; threshold both failure modes |
| Corpus overfit to mocks | Med | Nightly real-model calibration; corpus rotation |
| Persistence migration cost | Low | Log-table alternative in spec |

## Rollback Plan

Revert `packages/eval/` + CI job. Gate is additive: `runAgent`/TruthGate/abstention unchanged until spec wires `warn`/persistence.

## Dependencies

- Fase E merged code; `ConfirmedIncident` + `AgentActionLog` as seed
- Open product decisions → orchestrator grouped prompt (no inference)

## Success Criteria

- [ ] Keyless eval job fails PR on threshold breach
- [ ] Pink/red covers all 7 surfaces; same set PR + nightly
- [ ] Coverage, precision, abstention rate, gate FP per run and per tenant
- [ ] `warn` tier and verdict persistence decided and tested
