# Fase 3 PR #7 — Cognitive Investigation Card & Human Feedback UI

## Why

Roadmap Fase 3 (3.7): "Implementar ficha: resumen, evidencia, hipótesis/alternativas, faltantes, siguiente comprobación y validación humana de fase 1."

Following PR #120 (`ftth.investigation-result.v1` contract), PR #123 (evidence collector), PR #124 (facts & cognitive engine), PR #125 (server validator), PR #126 (immutable version persistence), and PR #127 (investigation API), this phase implements the NOC operator-facing investigation UI:

1. **Cognitive Investigation Ficha (`InvestigationCard`)**:
   - Executive summary and sufficiency status (`sufficient`, `provisional`, `insufficient`) along with the explicit `sufficiencyReason`.
   - Competing hypotheses with explainable support states (`supported`, `contradicted`, `mixed`, `unverified`) and explicit pointers to supporting (`forRefIds`) and opposing (`againstRefIds`) evidence. Never displays uncalibrated confidence percentages.
   - Traceable evidence catalogue displaying kind badges (`metric`, `event`, `topology`, `incident_history`, `feedback`), provenance/source, observation timestamps, summaries, and quality indicators (`fresh`, `stale`, `insufficient`, etc.).
   - Contradictions and missing observations (`what` and `whyItMatters`).
   - Suggested non-intrusive read-only checks (`observe_only`, `topology_lookup`, `recent_events`, `metric_history`).
   - Version metadata (version index, ruleset, model, snapshot timestamp) and re-investigate trigger (`refresh: true`).
   - Polling handling when investigation status is `pending` (HTTP 202).

2. **Phase 1 Human Feedback integration**:
   - Preserves technician adjudication controls ("Confirmar diagnóstico", "Incorrecto", "Faltan datos") bound to the exact immutable `versionId` and `runId`.
   - Displays feedback audit history for the active version.

3. **Incident Panel integration**:
   - Enhances `IncidentsPanel` to allow operators to inspect/expand the cognitive investigation card directly within the incident view.

## What changes

- `apps/web/components/InvestigationCard.tsx` (new):
  - Primary UI component displaying the full cognitive diagnosis envelope.
  - Handles GET retrieval, initial triggering, re-investigation (`refresh: true`), 202 polling, and versioned human feedback.
- `apps/web/components/IncidentsPanel.tsx`:
  - Integrates `InvestigationCard` toggle/view for each correlated incident.
- `apps/web/tests/components/investigation-card.test.ts` (new):
  - Unit and contract tests asserting UI snapshot strings, hypothesis support state rendering, evidence badge mapping, read-only check constraints, and role permissions.

## Out of scope

- End-to-end integration with LLM failure fault injection (Fase 3 PR #8 / Gate 3).
- Topology graph correlation engine (Fase 4).
