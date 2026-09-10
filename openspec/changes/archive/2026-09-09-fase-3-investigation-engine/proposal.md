# Fase 3 PR #3 — Cognitive investigation engine & deterministic facts

## Why

Roadmap Fase 3 (3.3): "Construir cálculos y hechos en código determinista; el LLM
propone interpretaciones/recomendaciones dentro del contrato."

Following PR #120 (`ftth.investigation-result.v1` envelope) and PR #123
(`collectInvestigationEvidence` in `@ftth-copilot/evidence`), the next step is the
core investigation engine in `@ftth-copilot/agent-core`.

The engine enforces strict separation between:
1. Deterministic facts: pure TypeScript computation of optical degradation,
   telemetry quality, event frequencies, shared topology hops, and historical context.
2. LLM cognitive interpretation: generating competing hypotheses with explicit
   support (`forRefIds`) and counter-evidence (`againstRefIds`), identifying
   contradictions, discovering missing observations, and suggesting strictly read-only
   checks, bounded by the `ftth.investigation-result.v1` envelope.
3. Server-side safety & citation hygiene: dropping any hallucinated evidence reference IDs,
   enforcing read-only check kinds, and providing safe fallback envelopes whenever the
   LLM is unavailable or produces unparseable output.

## What changes

- `packages/agent-core/src/investigation-facts.ts` (new):
  - Pure function `computeInvestigationFacts(evidenceRefs, window)`:
    - Optical power stats (min, max, delta, threshold breaches).
    - Event aggregates (dying-gasp, LOS, link-down counts and timeline).
    - Topology shared infrastructure (common ancestors, shared port/splitter).
    - Historical incidents context summary.
    - Deterministic missing observations and sufficiency assessment.
- `packages/agent-core/src/investigation-prompt.ts` (new):
  - System prompt and user message formatting injecting deterministic facts and
    explicit `evidenceRefId` catalog.
  - JSON schema instructions directing the model to output valid hypothesis structures.
- `packages/agent-core/src/investigation-engine.ts` (new):
  - Orchestrator function `investigateIncident(args)`:
    - Evaluates deterministic facts.
    - Invokes `LlmClient` when available.
    - Enforces citation integrity: purges unknown `forRefIds` / `againstRefIds`.
    - Guarantees read-only check kinds (`observe_only`, `topology_lookup`, etc.).
    - Returns an immutable, validated `InvestigationResult` adhering to `investigationResultSchema`.
- `packages/agent-core/src/index.ts`:
  - Re-exports `investigateIncident`, `computeInvestigationFacts`, and associated types.
- `packages/agent-core/tests/investigation-engine.test.ts` (new):
  - Unit and TDD tests validating facts computation, LLM parsing, citation pruning,
    error fallback, and schema compliance.

## Out of scope

- Server-side route handler `/api/incidents/[id]/investigate` and DB persistence
  on `InvestigationVersion.snapshotJson` (Fase 3 PR #4-5 / 3.4-3.5).
- Web UI investigation dashboard card and manual feedback wiring (Fase 3 PR #6-7 / 3.6-3.7).
