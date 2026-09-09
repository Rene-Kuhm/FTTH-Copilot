# Spec Delta: Cognitive Investigation Ficha and Human Feedback UI (Fase 3.7)

## Scenarios (Given/When/Then)

### Scenario: Ficha renders sufficiency status and reason without confidence percentages

Given an investigation result with sufficiency status (`sufficient`, `provisional`, or `insufficient`) and `sufficiencyReason`
When the `InvestigationCard` is rendered
Then it displays the sufficiency badge and textual reason
  and does not display any uncalibrated percentage score or confidence number.

### Scenario: Competing hypotheses display explainable support levels and explicit evidence pointers

Given an investigation result containing competing hypotheses
When the hypotheses list is rendered
Then each hypothesis displays its explainable support level (`supported`, `contradicted`, `mixed`, or `unverified`)
  and lists explicit references for supporting evidence (`forRefIds`) and opposing evidence (`againstRefIds`).

### Scenario: Evidence catalogue displays source, timestamp, and quality badges

Given an investigation result with evidence references
When the evidence catalogue is rendered
Then each item displays its kind (`metric`, `event`, `topology`, `incident_history`, `feedback`),
  source identifier, formatted observation timestamp, summary,
  and quality indicator (`fresh`, `stale`, `insufficient`, etc.).

### Scenario: Contradictions and missing observations are rendered explicitly

Given an investigation result with contradictions and missing evidence items
When rendered in the card
Then contradictions display the conflicting evidence reference ID and note,
  and missing items display what is missing (`what`) and why it matters (`whyItMatters`).

### Scenario: Suggested checks display only read-only actions

Given an investigation result with suggested checks
When the checks section is rendered
Then every check is constrained to read-only kinds (`observe_only`, `topology_lookup`, `recent_events`, `metric_history`)
  and displays description and expected resolution without any destructive or write actions.

### Scenario: Pending 202 response displays polling/in-flight indicator

Given an investigation request that returns HTTP 202 Accepted with status `pending`
When the card handles the pending state
Then it displays an in-progress indicator and schedules a poll to check for completion.

### Scenario: Re-investigate button triggers refresh action

Given a rendered investigation card with an existing version
When the operator clicks the re-investigate button
Then it sends a request with `{ refresh: true }` to obtain a newly computed version snapshot.

### Scenario: Feedback adjudication submits label bound to immutable versionId

Given a rendered investigation card with an active `runId` and `versionId`
When the technician clicks "Confirmar diagnóstico", "Incorrecto", or "Faltan datos"
Then the feedback submission targets `/api/investigations/[runId]/versions/[versionId]/feedback`
  with the selected label and updates the feedback history for that version.
