# `@ftth-copilot/evidence`

Phase B TruthGate — observation-mode envelope classification for
`evidence.provenance.v1` tool results.

## What it does

For every tool result string flowing through `runAgent`, the gate:

1. **Parses** the string as JSON. If it is not valid JSON → records
   `incomplete / parse-error / critical`.
2. **Validates** against `evidenceProvenanceSchema` from
   `@ftth-copilot/shared`. Schema mismatch → `incomplete /
   parse-error / critical`.
3. **Classifies** the three independent dimensions and lets the
   highest-severity verdict win:
   - **Confidence**: missing → `low_confidence / missing-confidence /
     warning`. Value `< 0.3` → `low_confidence / low-confidence-value
     / warning`. `>= 0.3` (inclusive) passes.
   - **Staleness**: strict `now > observedAt + ttlMs` → `stale /
     expired-ttl / warning`. Edge equality is fresh.
   - **Completeness**: `'complete'` passes; `'partial'` →
     `incomplete / partial-completeness / warning`; `'minimal'` →
     `incomplete / minimal-completeness / critical`.

Severity ranking: `incomplete (3) > stale (2) > low_confidence (1) > ok
(0)`. Tie-break on `severity` field (`critical > warning > info > ok`).

## Observe-mode invariant

Verdicts are recorded on `AgentResult.verdicts` but **never gate the
data flow**. The raw tool result string is always appended to the
next LLM message unchanged. Fase C will flip this to strict mode.

## Public API

```ts
import {
  classifyEnvelope,
  classifyUnwrapped,
  type Verdict,
  type VerdictCode,
  type VerdictSeverity,
} from '@ftth-copilot/evidence';

classifyEnvelope(parsed: unknown, toolName: string, now?: Date): Verdict;
classifyUnwrapped(toolName: string): Verdict;
```

`classifyUnwrapped` is for results that are not parseable envelopes
(`null`, `undefined`, error JSON, plain text) — returns
`incomplete / no-envelope / critical`.

## Demo == live (single classification path)

There is no mode-conditional branching. A demo envelope
(`source: 'smartolt.demo'`) and a live envelope (`source:
'smartolt.poll'`) with identical fields produce identical verdicts.
This keeps Fase C calibration data clean.

## Wiring

`runAgent` (in `@ftth-copilot/agent-core`) imports the gate,
classifies each tool result after `executeToolCall`, and pushes
the verdict onto a per-execution accumulator. Both return paths
include `verdicts` on `AgentResult`. `AgentResult.verdicts` is an
optional field — pre-Fase-B consumers keep working unchanged.

## Rollback

Delete `packages/evidence/`, revert the `runtime.ts` accumulator and
`shared/AgentResult.verdicts?` change, drop the openspec
config entry. Fase A continues working independently.

## Tests

```
pnpm --filter @ftth-copilot/evidence test
```

Covers staleness (fresh / stale / edge equality / +1ms past TTL),
confidence (missing / 0 / 0.2 / 0.3 threshold / 1.0),
completeness (complete / partial / minimal), aggregation
(stale+low_confidence → stale, stale+minimal → incomplete, all
three → incomplete), demo == live verdict identity, parse-error
path, and the public API surface.