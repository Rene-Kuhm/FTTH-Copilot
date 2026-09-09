# Fase 3 PR #1 — Investigation result contract `ftth.investigation-result.v1`

## Why

Roadmap Fase 3 (3.1): "Especificar el contrato en packages/shared,
con compatibilidad y límites de tamaño." The contract is the
authoritative envelope the investigation engine produces and the
UI renders. Without a closed, size-bounded envelope, downstream
consumers cannot reason about the diagnosis: a runaway hypothesis
list could blow up the LLM context, an unbounded free-text field
could carry PII or leak secrets.

## What changes

- `packages/shared/src/contracts.ts`: new section appended with the
  `ftth.investigation-result.v1` envelope and its building blocks.
  Reuses the existing `z.strict()`, `z.literal(schema)`, opaque IDs,
  and ISO-8601 datetime primitives from Fase 0.
- `packages/shared/tests/contracts-investigation-result.test.ts`
  (new): 19 tests covering schema discipline, bounded arrays, free
  text byte cap, window invariants, and the closed enums.

## Limits (documented as exported constants)

| Constant | Value | Why |
|---|---|---|
| `MAX_INVESTIGATION_EVIDENCE_REFS` | 64 | bounds the evidence array; matches LLM context budget. |
| `MAX_INVESTIGATION_HYPOTHESES` | 8 | competing hypotheses; more = harder to reason about. |
| `MAX_INVESTIGATION_CONTRADICTIONS` | 16 | evidence that contradicts the consensus. |
| `MAX_INVESTIGATION_MISSING` | 16 | known-gaps that would shift the diagnosis. |
| `MAX_INVESTIGATION_CHECKS` | 8 | suggested read-only checks per diagnosis. |
| `INVESTIGATION_FREE_TEXT_BYTES` | 4096 | UTF-8 byte cap on free text; matches Fase 1 feedback. |
| `MAX_INVESTIGATION_WINDOW_DAYS` | 30 | ventana temporal máxima; matches Fase 0 fixtures. |

## Closed enums

- `hypothesisSupportLevels = ['supported', 'contradicted', 'mixed', 'unverified']`.
  Roadmap 3.1: "No mostrar porcentajes de confianza sin calibración;
  usar estados explicables de soporte." No numeric confidence.
- `investigationCheckKinds = ['observe_only', 'topology_lookup', 'recent_events', 'metric_history']`.
  Roadmap regla 8: operaciones sobre NMS son solo lectura; el enum
  excluye explícitamente `reboot`/`provision`/`config_change`.
- `investigationSufficiencyStates = ['sufficient', 'provisional', 'insufficient']`.
  The investigation card renders these labels verbatim; the agent
  never invents a sufficiency percentage.

## Scenarios (Given/When/Then)

### Scenario: a valid minimal envelope parses

Given an envelope with one evidence ref, one hypothesis, one
missing observation and one suggested check
When `investigationResultSchema.parse` runs
Then the parsed object has the same `schema` literal and the
expected field shape

### Scenario: a hypothesis summary above 4 KiB is rejected

Given a hypothesis summary of 4097 bytes
When the schema parses
Then parsing MUST throw

### Scenario: a window of 31 days is rejected

Given `windowDays: 31`
When the schema parses
Then parsing MUST throw

### Scenario: windowEnd < windowStart is rejected

Given `windowEnd: '2026-09-01'`, `windowStart: '2026-09-08'`
When the schema parses
Then parsing MUST throw with a message mentioning `windowEnd`

### Scenario: cutoffAt > producedAt is rejected

Given a future `cutoffAt`
When the schema parses
Then parsing MUST throw with a message mentioning `cutoffAt`

### Scenario: a reboot check is rejected

Given a `suggestedChecks[0].kind === 'reboot'`
When the schema parses
Then parsing MUST throw

## Rules (RFC 2119)

- The envelope MUST use `.strict()` — unknown extra fields MUST be
  rejected, not silently dropped.
- The schema literal MUST be `ftth.investigation-result.v1`; the
  consumer MUST reject any other literal.
- A hypothesis MUST always carry `forRefIds` AND `againstRefIds`
  (both possibly empty). Roadmap 3.1: "Cada hipótesis MUST separar
  soporte y contraevidencia."
- A free-text field MUST NOT exceed `INVESTIGATION_FREE_TEXT_BYTES`.
- `producedBy` MUST be a stable string (`agent-core@x.y.z` for the
  automated engine, `human:<userId>` for manual adjudication).

## Out of scope

- The investigation engine that produces this envelope (Fase 3 PR #2).
- Persistence on `InvestigationVersion` rows (Fase 3 PR #3).
- UI surfaces (Fase 3 PR #5).
- Calibration of confidence values — never appears; the enum
  `hypothesisSupportLevels` is the only signal.
