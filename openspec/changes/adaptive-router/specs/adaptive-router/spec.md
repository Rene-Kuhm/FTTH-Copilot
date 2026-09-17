# Adaptive Router — Spec

**Change**: `adaptive-router`  
**Date**: 2026-09-17  
**Strict TDD**: true  
**Depends on**: `diagnostic-router` (PR #194/#195/#196 already merged)

---

## Purpose

Replace the binary `route()` (rule_based vs llm_agent) with a 3-mode hierarchy:

- **`direct`** — no LLM call. Run the selected tools deterministically, format the answer from the tool payloads.
- **`assisted`** — exactly one LLM call with a tools list restricted to the locally relevant subset.
- **`investigation`** — full cognitive loop (current behaviour). Up to 6 iterations, hypotheses, retrieval, TruthGate.

The router is invoked **before** the runtime loop. The selected mode + tool subset are passed into the runtime as `RouteDecision` so the loop can short-circuit (`direct` returns after the tool calls; `assisted` returns after the single LLM call).

The classification step is the existing `classifyIntention` (Block 2) + a new `selectMode` function that maps `(intention, querySignals) → DiagnosticRoute`.

---

## Requirements

### Requirement: `DiagnosticRoute` type

```typescript
export type DiagnosticMode = 'direct' | 'assisted' | 'investigation';

export interface DiagnosticRoute {
  mode: DiagnosticMode;
  tools: ReadonlyArray<string>;
  maxIterations: number;
  reason: string;
}
```

`reason` is human-readable for the audit log + Prometheus label.

### Requirement: Tool filter

`selectTools(mode, querySignals, allTools) → string[]` MUST return the minimum set of tool names the selected mode needs:

- `direct`: 1–2 tools (the one matching the query signal, e.g. `get_onu_detail` for "estado ONU-342").
- `assisted`: 2–4 tools (the query tool + a context tool like `get_topology_path` or `get_predicted_issues`).
- `investigation`: all tools (default).

### Requirement: Mode selection

`selectMode(querySignals) → DiagnosticMode` MUST classify based on:

- Signal strength: explicit device ID + low-cardinality action word (`estado`, `potencia`, `listar`) → `direct`.
- Moderate signal: question word + device ID + qualifier (`qué pasó con…ayer`) → `assisted`.
- Weak signal or ambiguous: multi-device or hypothesis-worthy → `investigation`.

The classifier is a deterministic precedence rule on top of `classifyIntention`. No new model.

### Requirement: `direct` mode execution

When mode is `direct`:

1. Run the first selected tool deterministically (`executeToolCall`).
2. Build a short answer by formatting the tool payload (no LLM call).
3. Wrap the answer in `AgentResult` with `verdicts` populated from `classifyToolResult`.
4. Apply `finalize` (TruthGate) — same as today.

Total LLM calls: 0.

### Requirement: `assisted` mode execution

When mode is `assisted`:

1. Build the restricted tools list (filter).
2. Run exactly one `llm.createMessage` call with the restricted tools.
3. If the LLM emits tool calls, run them (≤ 1 follow-up iteration). Persist any tool calls.
4. Apply `finalize`.

Total LLM calls: 1 (plus the optional follow-up if the LLM emitted a tool call on the first attempt; cap at 2 total).

### Requirement: `investigation` mode execution

Current behaviour. `maxIterations = 6`. All tools. Full loop. TruthGate.

### Requirement: `RouteDecision` carried through `AgentResult`

`AgentResult.route` is an optional field:

```typescript
route?: {
  mode: DiagnosticMode;
  tools: string[];
  maxIterations: number;
  reason: string;
};
```

This is additive (optional). Existing consumers that destructure `text` and `toolCalls` keep working.

### Requirement: Prometheus label for router mode

`/api/metrics` MUST emit `ftth_copilot_router_dispatches_total{mode="..."}` so the before/after measurement Block 1 enables is actually consumable.

### Requirement: Existing red corpus attack-pass-rate preserved

Running the full eval-harness (red + pink + intention corpus) MUST produce attack-pass-rate = 1.0 across all three modes. `direct` mode MUST NOT introduce a path that lets an injection case reach an LLM (it has no LLM, so this is automatic). `assisted` and `investigation` keep the current safety contract.

---

## Files to create

| File | Purpose |
|------|---------|
| `packages/agent-core/src/adaptive-router.ts` | `selectMode`, `selectTools`, `planRoute`, `executeDirect`, `executeAssisted` |
| `packages/agent-core/tests/adaptive-router.test.ts` | Mode selection, tool filter, runtime dispatch, safety invariants |
| `packages/agent-core/tests/runtime-direct-mode.test.ts` | Direct mode end-to-end (no LLM call) |
| `packages/agent-core/tests/runtime-assisted-mode.test.ts` | Assisted mode end-to-end (exactly 1 LLM call) |

## Files to modify

| File | Change |
|------|--------|
| `packages/agent-core/src/runtime.ts` | Branch on `route.mode` (planRoute is computed inside the loop); restrict tools by route.tools; honour route.maxIterations |
| `packages/agent-core/src/index.ts` | Re-export `selectMode`, `selectTools`, `planRoute`, `DiagnosticMode`, `DiagnosticRoute` |
| `packages/shared/src/index.ts` | Add optional `route?: { mode, tools, maxIterations, reason }` to `AgentResult` |
| `apps/web/lib/metrics/prometheus.ts` | Add `recordRouterDispatch(mode)` |
| `apps/web/app/api/chat/route.ts` | Call `recordRouterDispatch(result.route?.mode ?? 'unknown')` |

---

## Tests

```bash
turbo run test --filter=@ftth-copilot/agent-core
turbo run test --filter=@ftth-copilot/web
turbo run typecheck
```

---

## Success criteria

1. `planRoute('estado ONU-342')` → `{ mode: 'direct', tools: ['get_onu_detail'], maxIterations: 0, reason: '...' }`.
2. `planRoute('qué pasó con ONU-342 ayer')` → `{ mode: 'assisted', tools: ['get_onu_detail', 'get_predicted_issues'], maxIterations: 1, reason: '...' }`.
3. `planRoute('caída progresiva de RX en 28 ONUs, causa raíz')` → `{ mode: 'investigation', tools: all, maxIterations: 6, reason: '...' }`.
4. `runAgent` with mode `direct` performs 0 LLM calls (verified via mock).
5. `runAgent` with mode `assisted` performs exactly 1 LLM call when LLM emits no tool call, or ≤ 2 when it does.
6. `runAgent` with mode `investigation` performs up to `maxIterations` LLM calls (current behaviour preserved).
7. Eval-harness attack-pass-rate = 1.0 across all 3 modes.
8. `ftth_copilot_router_dispatches_total{mode=...}` emits real counts (not zero) when the chat route runs.
9. `turbo run typecheck` passes; all `turbo run test` pass.
