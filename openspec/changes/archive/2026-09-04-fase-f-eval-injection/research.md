# SDD Research — fase-f-eval-injection
schema: gentle-ai.sdd-research/v1
revision: 1
status: blocked
change: fase-f-eval-injection
artifact_store: hybrid

## Retained selected request
- Change: fase-f-eval-injection (Fase F — permanent evaluation against real failures + prompt injection defense)
- Repo: /home/tecnodespegue/workspace/FTTH-Copilot
- Selected research lanes (mandatory):
  1. Taxonomias prompt injection — attack taxonomies to design the pink/red attack corpus
  2. Patrones eval harness — deterministic eval harness patterns for packages/eval
  3. Metricas de evidencia — coverage, precision, abstention rate, false positives over confirmed-incident corpus
- Requested source classes: documentation, open-web
- Declared capability: gentle-ai.sdd-research-capability/v1 with exact grants for documentation and open-web

## Retained canonical desired content (explore, read-only)
- 65 vitest suites with deterministic mocks; Playwright e2e route-mocks the agent and cannot prove gate defense; manual QA log in docs/validation/ with no automated corpus.
- 7 untrusted input surfaces reaching the LLM with zero instruction-content filtering and metadata-only TruthGate; unwired warn tier; verdicts never persisted to DB.
- Recommended strategy A (new packages/eval + JSON attack corpus + vitest runner + CI threshold job, deterministic, keyless) + D (scheduled calibration leg with keys) as backbone; never C for gate proof.
- Open proposal-scope questions retained as questions only (no product answers in research).

## Research questions
1. Direct vs indirect injection categories and which surfaces they map to in this codebase.
2. Deterministic harness designs that assert "no unsupported factual claim" without an LLM in the loop.
3. Metric definitions (coverage/precision/abstention-rate/false-positives) over a ConfirmedIncident + verdict-log corpus and their known pitfalls.

## Admission
- requested_classes: ["documentation", "open-web"]
- declared_capability: gentle-ai.sdd-research-capability/v1
- observed_exact_grants:
  - documentation: []
  - open-web: []
- admission_result: denied
- admission_detail: Both requested classes report empty exact grants. Per hard rules, unsupported or undeclared classes deny admission and emit no claims. No source access was performed. No claim is validated.

## Sources
- none
- reason: admission denied; denial produces no source claims. No source IDs were created.

## Validated claims
- none
- reason: admission denied; partial or blocked outcomes MUST exclude unvalidated claims.

## Contradictions
- none recorded (no sources collected).

## Uncertainty
- All three lanes remain unsupported: attack taxonomies, deterministic harness patterns, and evidence metrics have zero validated sources in this revision.

## Freshness
- accessed_at: none (no source access)
- evidence_date: 2026-09-03
- staleness: not applicable — no evidence collected.

## Product choices (non-authoritative, separate from evidence)
- No product decisions are made or confirmed by this research artifact. Proposal-scope questions above remain pending for orchestrator-owned product discovery. This section carries no evidential weight.
