# Adaptive Router — Design

**Change**: `adaptive-router`  
**Date**: 2026-09-17  
**Strict TDD**: true

---

## Architecture Decision Records

### AD-1: Mode selection is deterministic precedence, not a model

`selectMode()` is a pure function on `(intentionLabel, querySignals)`. It does NOT call an LLM. It uses:

1. `classifyIntention` (Block 2 — already merged) to get the label.
2. A regex-based `querySignals` extractor that pulls out device IDs, action words, question marks, multi-device hints.
3. A precedence table:

| Label | Action word | Device ID | Question | Mode |
|-------|-------------|-----------|----------|------|
| routine_topology | listar / estado / detalle / mostrar | yes | no | direct |
| routine_topology | any | yes | no | direct |
| routine_topology | any | no | yes | assisted |
| routine_topology | any | no | no | investigation |
| incident_diagnosis | any | yes | no | direct |
| incident_diagnosis | any | yes | yes | assisted |
| incident_diagnosis | any | no | any | investigation |
| advisory | any | any | any | investigation |

This is a deterministic v1; Block 3's distribution data will replace it.

### AD-2: Tool filter is regex-based, not embedding-based

`selectTools(mode, querySignals, allTools)` extracts signals:

- `(onu|olt)-?\d+` patterns → `get_onu_detail`, `get_olt_detail`, `get_topology_path`
- `potencia|rx|signal` keywords → `get_onus_with_low_signal`, `get_onu_detail`
- `ayer|hoy|histórico` keywords → `get_predicted_issues`
- `caíd[oa]|causa raíz` keywords → `get_predicted_issues`, `get_topology_path`, `get_downstream_clients`
- `topologí[a]|árbol` keywords → `get_topology_path`, `get_downstream_clients`

For `direct` mode: return 1 tool (the most-specific match).
For `assisted` mode: return 1 query tool + 1 context tool (topology or predicted issues).
For `investigation` mode: return all tools.

### AD-3: `direct` mode never calls LLM

The runtime short-circuits before the `llm.createMessage` call. The answer is built by formatting the tool result with a small adapter function (no LLM). For status/power queries, this is a single-line response.

### AD-4: `assisted` mode caps LLM calls at 1 (or 2 if tool call)

First call includes tools. If the LLM emits tool calls, run them and call once more to let the LLM summarise. Cap at 2 LLM calls total. If the second LLM call returns no text (pure tool-call), run the tool and return the formatted result.

### AD-5: `investigation` mode is the current loop

No change. `maxIterations = 6` default. Full tools. Full retrieval. TruthGate.

### AD-6: AgentResult.route is additive

Optional field. Existing consumers that destructure `text`, `toolCalls`, `verdicts`, `abstention`, `abstained`, `warnings`, `tokens`, `costUsd`, `latencyMs` keep working. The chat route uses `result.route?.mode` to record the Prometheus label.

### AD-7: Tests mirror the existing pattern

`runtime.test.ts` mocks `createLlmClient` via `deps.runAgent` injection. We extend this with `mode: 'direct'`, `mode: 'assisted'`, `mode: 'investigation'` test cases. Each mode gets a separate test file to keep failures isolated.

---

## Slice plan

### Slice 1 — Pure routing logic (no runtime changes)
- `selectMode`, `selectTools`, `planRoute` (pure functions)
- Tests: 30+ covering every signal combination
- Size: ~200 lines

### Slice 2 — Runtime wiring (3 modes)
- `runtime.ts` branches on `planRoute()`
- New `executeDirect` and `executeAssisted` paths
- Tests: ~150 lines covering all 3 modes
- Size: ~250 lines

### Slice 3 — Prism + telemetry
- `AgentResult.route` field
- `recordRouterDispatch(mode)` in `prometheus.ts`
- Wire in chat route
- Tests: ~80 lines
- Size: ~120 lines

### Total: ~720 lines, 3 PRs.

---

## Strict TDD instruction (forwarded to sdd-apply)

```
STRICT TDD MODE IS ACTIVE. Test runner: pnpm vitest run.
Follow RED, GREEN, REFACTOR. Record evidence per phase.
```

---

## Test commands

```bash
turbo run test --filter=@ftth-copilot/agent-core
turbo run test --filter=@ftth-copilot/web
turbo run test --filter=@ftth-copilot/eval
turbo run typecheck
```
