# Laya Runtime Integration — Design

**Change**: `laya-runtime-integration`
**Date**: 2026-10-07
**Strict TDD**: true
**Depends on**: `adaptive-router` (already merged)

---

## Architecture Decision Records

### AD-1: The recording hook lives at the orchestration call site, not inside `planRoute`

`planRoute` is documented as purity-contracted:

- `packages/agent-core/src/adaptive-router.ts:4-7` — *"Pure routing logic ... No LLM, no I/O, no
  runtime coupling"*
- `packages/agent-core/src/adaptive-router.ts:353` — *"Pure (no LLM, no I/O)."*

It is exported, unit-tested directly, and its only production caller is
`packages/agent-core/src/runtime.ts:317` (`planRoute` is invoked exactly once per `runAgent()`;
no other non-test call site exists in the repo).

**Decision**: record the decision in `runtime.ts`, at and after the `planRoute` call.

**Rationale**: a metrics increment is a side effect on a module-level singleton
(`laya-metrics.ts:163`). Putting it inside `planRoute` would falsify two doc comments that the
codebase and its reviewers rely on, and would make every direct `planRoute` test write into the
shared singleton. The orchestration layer is where the app already records routing facts —
`apps/web/app/api/chat/route.ts:301` records dispatch after the fact. Following that precedent
keeps `adaptive-router.ts` a pure function and puts the I/O-adjacent work where I/O already lives.

**Accepted trade-off**: a future second consumer of `planRoute` will not record automatically. This
is a deliberate cost: an explicit hook at each orchestration entry point is cheaper to reason about
than a hidden impurity in a function documented as pure. If a second caller appears, it gets its
own explicit call.

### AD-2: One exported resolver owns Laya env defaulting

Two modules disagree today for the same variable:

| Module | `LAYA_ENABLED` | `LAYA_MODE` |
|---|---|---|
| `laya-shadow.ts:192-193` | `!== 'false'` → **true** | `?? 'shadow'` |
| `laya-client.ts:47-48` | `=== 'true'` → **false** | `?? 'disabled'` |

**Decision**: `enabled` is **opt-in** (`LAYA_ENABLED === 'true'`) and `mode` defaults to
`'shadow'`, resolved once in a single exported function that both modules delegate to.

**Rationale**: opt-in is the safe default for a component that can influence request routing, and
it matches the operator contract already published in `.env.example`
(`LAYA_ENABLED=false` + `LAYA_MODE=shadow`) and in `docker-compose.yml:43`
(`LAYA_MODE: ${LAYA_MODE:-shadow}`). Two resolution rules for one variable is a defect regardless
of which default wins; collapsing them removes the class of bug, which is the actual objective.

**Note**: this flips `laya-shadow.ts`'s default from enabled to disabled. Its exports
(`shouldLogDecision`, `toDecisionLog`, `setLayaLogHandler`, `logLayaDecision`) are logging helpers
with no production caller outside `packages/shared`, so no reachable behavior changes; a test
asserting both loaders agree pins the new contract.

### AD-3: `shadow` records and does not route; only `assisted`/`automatic` may change the mode

The ADR's four modes must be observably distinct, otherwise `LAYA_MODE` is decorative:

| Mode | Consult source | Record metric | May change route |
|---|---|---|---|
| `disabled` | no | no | no |
| `shadow` | yes | yes | **no** |
| `assisted` | yes | yes | yes, via `mergeRoutingDecision` with configured thresholds |
| `automatic` | yes | yes | yes; Laya may pick the route directly |

**Rationale**: `shadow` exists precisely to gather evidence without risk, so it MUST NOT alter the
route — that is the property that makes it safe to enable in production. Recording in `shadow` is
what makes the dashboard meaningful and is the whole point of Phase 2.

### AD-4: A classification failure is recorded, not swallowed

`adaptive-router.ts:363-370` wraps classification in `try/catch` and fails open by leaving
`eventClass` undefined. The catch logs to `console.warn` only, so a permanently broken classifier
is invisible in metrics.

**Decision**: at the call site, `route.eventClass === undefined` is recorded with
`result: 'error'` for the resolved mode.

**Rationale**: the fail-open path is exactly where operators need signal, since the product keeps
working while a decision layer is silently dead. This mirrors the defect found in the same
subsystem where `recordFailure()`'s `opened` return value is discarded at `laya-client.ts:502,533,582`.

### AD-5: Inbound Laya responses MUST be validated; an invalid response is a failure, not a decision

`layaDecisionSchema` is imported at `laya-client.ts:25` and `laya-integration.ts:24` and used
nowhere. Outbound events are validated (`laya-integration.ts:245`,
`layaDecisionEventSchema.safeParse`) but inbound decisions are cast with `as` and defaulted with
`??` in `mapResponseToLayaDecision` (`laya-client.ts:406-436`).

**Decision**: validate inbound payloads with `layaDecisionSchema` and treat a validation failure as
a transport failure (fail-open according to `failOpen`, with `result: 'error'`).

**Rationale**: today an empty or malformed response becomes a *valid-looking* decision
(`eventClass: 'UNKNOWN'`, `severity: 'INFO'`, `requiresInvestigation: true`,
`confidence.eventClass: 0`). A silent wrong answer is worse than a recorded failure. Validating
what enters while trusting what leaves is an asymmetry with no justification.

### AD-6: The Laya signal enters `planRoute` as an input, not as a post-hoc override

ADDED 2026-10-07, during Phase 4 planning.

`planRoute` derives `mode`, then `tools` and `maxIterations` **from that mode**
(`adaptive-router.ts`: `const tools = selectTools(mode, signals, opts.allTools)` and the
`maxIterations` ternary). Overriding `route.mode` after `planRoute` returns therefore leaves
`tools` and `maxIterations` computed for the old mode. The failure is silent and severe: a route
promoted to `investigation` keeps `maxIterations: 0`, so the cognitive loop never runs and the
agent answers as if it had investigated.

**Decision**: add an optional `layaSignal` to `PlanRouteOptions` and apply the mode override
**inside** `planRoute`, before `tools` and `maxIterations` are derived. `runtime.ts` decides
*whether* to consult; `planRoute` remains the only place that derives a consistent route.

**Rationale**: this preserves the purity contract of AD-1 exactly. The function stays a pure
function of its inputs — a signal passed in is an input, not a side effect — while making an
internally inconsistent route impossible to construct. Post-hoc mutation would have traded a
documented impurity for an undocumented correctness bug.

### AD-7: Shadow passes no signal, so it cannot change the route by construction

ADDED 2026-10-07, during Phase 4 planning.

`shadow` MUST NOT alter the route (R4.2). Rather than consult and then discard the result through
a conditional, `runtime.ts` passes `layaSignal: null` in shadow mode. The route override becomes
unreachable in shadow by construction, not by discipline.

Shadow still consults the service, because measuring agreement between the local expert
classification and the Laya decision is the entire purpose of shadow mode and the input to the
decision to enable `assisted`. **Accepted trade-off**: this puts a bounded HTTP call on the
routed request path even in shadow. The call is bounded by `LAYA_TIMEOUT_MS` (default 250 ms) and
fail-open, so the worst case is added latency, never a failed request. Operators who do not want
that cost keep the default `LAYA_ENABLED=false`, in which case nothing is consulted at all.

The recorded `result` distinguishes the outcomes: `success` when Laya answered, `fallback` when
`failOpen` absorbed an unreachable service, `error` when the classifier failed (AD-4).

## Sequence: shadow mode (default after this change)

```
operator query
  │
  ▼
runtime.ts  ──► resolveLayaEnv()  ──► { enabled, mode }
  │                 │
  │                 └─ enabled=false ────────────► no record, no consult (inert path)
  │
  ▼
planRoute({ userMessage })            [PURE — unchanged]
  │
  ├─ classifyIntention → label
  ├─ extractSignals    → signals
  ├─ selectMode        → mode
  └─ getExpertClassifier().classify() → eventClass, eventConfidence
  │                                     (catch → undefined, fail-open)
  ▼
DiagnosticRoute
  │
  ├─ mode !== 'shadow' && mode !== 'disabled'
  │     └─► LayaIntegration.processEvent()  ──► LayaDecision | null
  │              └─ null (fail-open) ──► keep adaptive route, result='error'|'fallback'
  │
  ▼
layaMetrics.recordDecision(eventClass, confidence, mode, result, latencyMs?)
  │
  ▼
runtime continues with DiagnosticRoute          [route UNCHANGED in shadow]
```

Prometheus path, unchanged and already live:

```
GET /api/metrics → prometheus.ts:313 layaMetrics.toPrometheusFormat()
                 → ftth_laya_requests_total{mode,event_class,result} N   ← first real samples
                 → /dashboard/laya LayaMetricsPanel.tsx:39 parses them
```

## Data shape used by the hook

```typescript
// packages/shared/src/laya-metrics.ts:32-39  (existing, unchanged)
recordDecision(
  eventClass: string,
  confidence: number,
  mode: LayaMode,              // 'disabled' | 'shadow' | 'assisted' | 'automatic'
  result: LayaResult = 'success', // 'success' | 'fallback' | 'timeout' | 'error'
  suggestedRoute?: string
): void
```

`mode` is recorded as the *resolved Laya mode*, not the diagnostic route mode
(`direct|assisted|investigation`). The panel labels its rows from the metric's `mode` label, so
recording the diagnostic mode would mislabel the dashboard.

## Known trap recorded for the implementer

`LayaMetricsCollector.recordDecision` increments a `Map` counter
(`laya-metrics.ts:28`: `set(k, (get(k) ?? 0) + 1)`). Recording the same decision twice
double-counts. The hook MUST run exactly once per `runAgent()` invocation; `planRoute` MUST NOT
also record.
