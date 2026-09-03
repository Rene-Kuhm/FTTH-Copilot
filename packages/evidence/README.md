# `@ftth-copilot/evidence`

Fase B TruthGate — observation-mode envelope classification for
`evidence.provenance.v1` tool results — plus Fase C strict-mode
abstention policy that flips the gate from observation to enforcement —
plus Fase D confirmed-incident memory + sparse-first hybrid retrieval
(BM25 over pre-computed `searchTokens`, `RRF_K = 60` plumbing ready for
Phase 2 dense merge).

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
next LLM message unchanged. Fase C flips this to strict mode for
`incomplete` verdicts (see below).

## Public API

```ts
import {
  classifyEnvelope,
  classifyUnwrapped,
  // Fase C (strict-mode abstention)
  shouldAbstain,
  buildAbstention,
  nextStepFor,
  formatIdentifierNextStep,
  formatMetricsNextStep,
  ABSTENTION_SCHEMA,
  abstentionSchema,
  type Verdict,
  type VerdictCode,
  type VerdictSeverity,
  type TruthGateMode,
  type AbstentionDecision,
  type Abstention,
} from '@ftth-copilot/evidence';

classifyEnvelope(parsed: unknown, toolName: string, now?: Date): Verdict;
classifyUnwrapped(toolName: string): Verdict;

// Strict-mode override (Fase C). Pure functions over Verdict[] + mode.
shouldAbstain(verdicts: Verdict[], mode: TruthGateMode): AbstentionDecision;
buildAbstention(verdicts: Verdict[], claim?: string): Abstention;
nextStepFor(reason: string, toolsAffected: string[]): string;
```

`classifyUnwrapped` is for results that are not parseable envelopes
(`null`, `undefined`, error JSON, plain text) — returns
`incomplete / no-envelope / critical`.

## Strict-mode abstention (Fase C)

When the gate is run in `strict` mode (the default for `runAgent` and
for the chat route unless `TRUTH_GATE_MODE=observe` is set), every
incomplete verdict triggers the gate to **replace the LLM's text**
with a deterministic operator-facing abstention envelope
(`ftth.abstention.v1`). `stale` and `low_confidence` stay as warnings;
the LLM still sees the data and decides how to phrase it.

### Asymmetric policy table

| Mode | Verdict | Decision | What `runAgent` does |
|------|---------|----------|----------------------|
| `strict` | `incomplete` | `abstain` | Replace LLM text with rendered abstention; attach `abstention` + `abstained: true` to `AgentResult` |
| `strict` | `stale` | `warn` | LLM text passes through; verdict recorded on `AgentResult.verdicts` |
| `strict` | `low_confidence` | `warn` | LLM text passes through; verdict recorded |
| `strict` | `ok` | `allow` | LLM text passes through; verdict recorded |
| `observe` | any | `allow` | LLM text passes through; verdict recorded (Fase B behavior) |

### Spanish `nextStep` templates

The `abstention.nextStep` string is a deterministic Argentine
Rioplatense (voseo) hint that references the affected tools. Two
variants are emitted:

- **Identifier variant** (`formatIdentifierNextStep`) — selected when
  any affected toolName hints at an identifier lookup (regex
  `/onu|olt/i`). Verbs: `Verificá`, `volvé`.
- **Metrics variant** (`formatMetricsNextStep`) — default for
  metrics / telemetry / history tools and the fallback for every
  other reason. Verbs: `Re-colectá`, `15 minutos`.

Both templates are byte-locked by snapshot tests in
`packages/evidence/tests/abstention-policy.test.ts`.

### Environment override

`apps/web/app/api/chat/route.ts` reads
`process.env['TRUTH_GATE_MODE']` and forwards it to `runAgent` as
`opts.mode`. Valid values are `'strict'` (default) and `'observe'`.
Anything else falls back to `'strict'` so a typo can never silently
disable the gate.

```bash
# Per-deployment rollback without rebuild
TRUTH_GATE_MODE=observe pnpm dev
```

The runtime-level default (`DEFAULT_TRUTH_GATE_MODE`) is exported from
`@ftth-copilot/agent-core` and is the same constant the route defaults
to when the env var is absent.

## Demo == live (single classification path)

There is no mode-conditional branching. A demo envelope
(`source: 'smartolt.demo'`) and a live envelope (`source:
'smartolt.poll'`) with identical fields produce identical verdicts and
identical abstention envelopes. This keeps Fase B → Fase C calibration
data clean and avoids source-conditional policy drift.

## Wiring

`runAgent` (in `@ftth-copilot/agent-core`) imports the gate,
classifies each tool result after `executeToolCall`, and pushes
the verdict onto a per-execution accumulator. Both return paths
include `verdicts` on `AgentResult`. When `shouldAbstain` returns
`'abstain'`, a single `finalize` helper replaces the LLM's text with
`formatAbstentionText(abstention)` and attaches the abstention fields.
`AgentResult.verdicts` and `AgentResult.abstention` are optional
fields — pre-Fase-B and pre-Fase-C consumers keep working unchanged.

## Rollback

There are three independent rollback paths, in order of blast radius:

1. **Per-deployment, no rebuild** — set `TRUTH_GATE_MODE=observe` on
   the web app process. `apps/web/app/api/chat/route.ts` forwards the
   value verbatim; `runAgent` keeps Fase B behavior.
2. **Code-level** — flip `DEFAULT_TRUTH_GATE_MODE` in
   `packages/agent-core/src/runtime.ts` from `'strict'` to
   `'observe'` and rebuild. The override helper becomes a no-op for
   every call site.
3. **Full revert** — delete `packages/evidence/` plus the
   `abstention-policy.ts` module, revert the `runtime.ts` accumulator
   + `shared/AgentResult.abstention?` + `ChatResponse.abstention?`
   changes, drop the openspec config entry. Fase A and Fase B
   continue working independently; Fase C is removed.

## Tests

```
pnpm --filter @ftth-copilot/evidence test
```

Covers staleness (fresh / stale / edge equality / +1ms past TTL),
confidence (missing / 0 / 0.2 / 0.3 threshold / 1.0),
completeness (complete / partial / minimal), aggregation
(stale+low_confidence → stale, stale+minimal → incomplete, all
three → incomplete), demo == live verdict identity, parse-error
path, the asymmetric policy table (strict + incomplete → abstain;
strict + stale → warn; strict + low_confidence → warn; strict + ok →
allow; observe + any → allow), `buildAbstention` derivation
(mixed missing/available/toolsAffected, all-incompletes,
non-`ok` toolsAffected, deduplication), the Spanish `nextStep`
snapshot tests (voseo verb + tool reference + byte-identical ×2),
and the public API surface re-exports.

## Confirmed-incident memory + hybrid retrieval (Fase D)

The Fase D layer adds **sparse-first retrieval over a tenant-scoped
`ConfirmedIncident` knowledge base**. Retrieved rows are background
context — never evidence — and flow into the LLM system prompt under
an explicit "contexto, no evidencia" heading so the agent can never
confuse them with a measurement.

### Spanish context block

`RELEVANT_INCIDENTS_HEADING` is the design-locked Spanish literal:

```
## Incidentes previos relevantes (contexto, no evidencia)

(Estos son contexto de la historia del ISP; no los cites como evidencia de la medición actual.)
```

`formatRelevantIncidentsBlock(incidents)` renders one line per row,
1-indexed and score-formatted to two decimals:

```
[N] YYYY-MM-DD — {deviceId} {summary}. Causa raíz: {rootCause}. Fix: {fix}. Score: {n.nn}
```

Both literals are byte-locked by snapshot tests.

### `retrieveRelevantIncidents` args contract

```ts
retrieveRelevantIncidents({
  tenantId: string;       // required; throws MissingTenantError when empty
  query: string;          // operator question; tokenized via BM25Lite.tokenize
  deviceHint?: string | { deviceKind: 'OLT' | 'ONU'; deviceId: string };
  limit?: number;         // default 5
  sinceDays?: number;     // default 90
  mode?: 'live' | 'demo'; // 'demo' short-circuits to []
  now?: Date;             // injected for tests; default new Date()
  confirmedIncidents: ConfirmedIncident[]; // loaded by the caller (route)
}): RelevantIncidentResult[]
```

Demo mode is a hard short-circuit (no DB query, no ranking); the
caller is responsible for not invoking retrieval when
`dataSource.mode === 'demo'`. The function is pure: same input →
same output, no Prisma dependency, no env reads. `RRF_K = 60` is
exported so Phase 2 dense-merge uses the same reciprocal-rank-fusion
constant without re-locking the value.

### `BM25Lite` — pure-TS scorer

`scoreBM25(queryTokens, docTokens, avgDocLen, k1 = 1.5, b = 0.75)`
plus the `BM25_STOPWORDS` trimmed set and `BM25_STOPWORDS_FULL` Phase-2
extended set. Tokenization is locked at write time on
`ConfirmedIncident.searchTokens` so later BM25 parameter changes never
retroactively re-rank history.

### `PendingIncidentCandidate` builder + promotion gate

`buildPendingIncidentCandidate({ tenantId, summary, toolCallsJson,
sourceIncidentId?, runSessionId?, now? })` produces a
`ftth.pending-incident-candidate.v1` draft (id `''`, status `'pending'`).
The chat route writes one row per clean (non-abstained, no `incomplete`
verdict) live run.

`eligibleForPromotion(candidate, sourceIncident, now,
hasIncompleteVerdict)` is the pure gate the admin route uses:
all four conditions must hold (pending status, source incident
resolved, ≥24h elapsed since `resolvedAt`, originating run had no
incomplete verdict). The admin route lives at
`apps/web/app/api/pending-incidents/promote` (OWNER role) and calls
`promotePendingIncidents(now)` from `apps/web/lib/promote-pending-incidents`.

### Rollback

The Fase D retrieval layer is opt-in at every layer:

- `RunAgentOptions.retrievalProvider` is optional — when undefined,
  the loop runs with no augmentation and the runtime is byte-identical
  to the Fase C baseline.
- `ConfirmedIncident` is a new table; down migration drops both
  tables and the `ConfirmedBy` enum.
- The chat-route write gate reuses the existing verdict set; flipping
  `TRUTH_GATE_MODE=observe` keeps the chat path identical to Fase C
  (no candidate writes from observe-mode runs).
- `promotePendingIncidents` is admin-triggered only; no cron / worker
  is registered, so disabling the admin route is a one-line revert.

To roll back Fase D entirely:

1. Drop the two new tables via the manual down migration
   (`DROP TABLE pending_incident_candidates; DROP TABLE confirmed_incidents; DROP TYPE "ConfirmedBy";`).
2. Revert `packages/agent-core/src/runtime.ts` to remove the
   `retrievalProvider` block.
3. Revert `apps/web/app/api/chat/route.ts` to drop the
   `retrievalProvider` closure + the `PendingIncidentCandidate` write.
4. Revert `apps/web/app/api/incidents/[id]/confirm/route.ts`,
   `apps/web/app/api/pending-incidents/promote/route.ts`,
   `apps/web/lib/promote-pending-incidents.ts`, and the
   `IncidentsPanel.tsx` modal.
5. Revert `packages/evidence/src/{bm25-lite,relevant-incidents,pending-incident}.ts`
   + the re-exports in `index.ts`.

Phases A/B/C are unaffected; the retrieval augmentation is pure
addition on top of the existing data path.
