# Exploration — Fase A: Provenance

## Current State

**Contracts (`packages/shared/src/contracts.ts`)** are zod schemas with a version-marker convention: a string literal constant (`TELEMETRY_SCHEMA = 'ftth.telemetry.v1'`) embedded as `schema` field, plus an enum/literal source vocabulary. Three contracts exist: `telemetry.v1` (ingesta, already has `tenantId`, `source`, `ts`, open `metrics` passthrough), `finding.v1` (already has `confidence`, `evidence`, `context.tenantId`), `action.v1`. Golden tests live in `packages/shared/tests/contracts.test.ts` (9 tests, pass): a `valid` fixture per contract, then negative cases that mutate one field and assert `safeParse(...).success === false`.

**Tool flow (`packages/agent-core/src/tools/index.ts`)** — `executeToolCall(connector, toolName, args, predictionProvider?)` returns `Promise<string>`. It `switch`es on tool name, calls the connector method, then returns `JSON.stringify(data, null, 2)` (line 184). Error/null paths return ad-hoc strings. `buildDefaultConnector()` picks mock vs live via `process.env.SMARTOLT_USE_MOCK !== 'false'`. `runAgent` (`runtime.ts`) calls `executeToolCall` (line 71), pushes a `ToolCallRecord` (`{name, arguments, result}`), then concatenates results into a single user-message string sent back to the LLM. `RunAgentOptions.dataSource` is `{ mode, provider, label }` — `connectionId` is dropped at this boundary.

**Tenant / observation origin.** The chat route (`apps/web/app/api/chat/route.ts`) has `user.tenantId` and resolves a connector via `resolveTenantConnector` (`apps/web/lib/connectors/chat-client.ts`), which yields `ResolvedConnector = { connector, dataSource }` where `dataSource` carries `mode: 'live'|'demo'`, `connectionId`, `provider`, `label`. For demo mode `useMock: true`; for live `useMock: false`. The schedule/poller (`apps/web/lib/monitoring/scheduler.ts`) passes `{ tenantId, connectionId }` as `meta`. Prisma adds `MetricSample.sampledAt` (`@default(now())`) and `DetectedAlert.confidence`, `lastSeenAt`, `etaMs`.

**Where provenance lands:** `runAgent` currently receives `dataSource` (with `connectionId`) but only `ExecuteToolCall` is called with just `(connector, name, args, predictionProvider)`. There is no tenant/observedAt plumbing into `executeToolCall` today — the enrichment must add a context argument.

## Affected Areas

- `packages/shared/src/contracts.ts` — add `evidence.provenance.v1` zod schema + version constant.
- `packages/shared/tests/contracts.test.ts` — add golden tests (same pattern).
- `packages/agent-core/src/tools/index.ts` — `executeToolCall` wrapper / signature (`source` derivation from mock vs live, `observedAt`, metadata).
- `packages/agent-core/src/runtime.ts` — pass tenant/source context into `executeToolCall`.
- `packages/agent-core/src/index.ts` — export new provenance helpers if exposed.
- `apps/web/app/api/chat/route.ts` — pass `tenantId` + `connectionId` into `runAgent` (currently not threaded).
- `packages/agent-core/src/llm.ts`, `packages/agent-core/src/prompts/system.ts` — NOT changed (no behavior change in Phase A).
- `apps/web/lib/connectors/chat-client.ts` — already carries `connectionId`; only needs to forward into `runAgent`.

## Approaches

1. **Wrap inside `executeToolCall` (in-place envelope)** — `executeToolCall` returns a JSON string shaped `{ schema, provenance, data }` instead of the raw data.
   - Pros: single choke point, all 8 tools enriched uniformly; source derivable from `connector.useMock`/`providerName`; tests updated in one file.
   - Cons: changes `executeToolCall` return shape ⇒ `tools.test.ts` assertions break (must update); `runtime.ts` result string embedding needs a decision on how provenance is represented in the LLM message.
   - Effort: Medium.

2. **Separate enrichment layer (`enrichWithProvenance`)** — keep `executeToolCall` returning raw JSON, add a wrapper that stamps provenance onto the string before `runAgent` embeds it.
   - Pros: `executeToolCall` contract preserved (less test churn); provenance is an explicit pure function, easy to golden-test.
   - Cons: one more function/layer; still must thread tenant/source context into `runAgent`.
   - Effort: Low–Medium.

## Recommendation

- **Structure the contract as a wrapping object**, matching the roadmap intent (`enrich`, not sprinkle): `{ schema: 'evidence.provenance.v1', ...metadata... }` wrapping the connector payload. Store the raw data under an explicit key (e.g. `data`) so it is never confused with top-level `finding.v1`/`telemetry.v1` fields — but DO NOT reuse the pipeline `schema` field semantics; keep `evidence.provenance.v1` distinct.
- **Enrichment layer:** prefer **Approach 1 (choke point in `executeToolCall`)** because the roadmap explicitly says "cada `executeToolCall` envuelve el JSON crudo", and it centralizes source derivation. Keep the wrapper thin and pure; add a `provenance` context object argument so `runtime.ts` can inject `{ tenantId, source, observedAt }`.
- **`source` derivation:** derive automatically from the active connector — `source = connector providerName + (mock ? '.demo' : '.poll')` (e.g. `smartolt.demo`, `smartolt.poll`), with `predictionProvider` (get_predicted_issues) mapping to a `curated`/`finding` source. Do not pass an explicit per-call source from the app.
- **`observedAt`/`calledAt`:** an ISO timestamp captured once per tool execution inside `executeToolCall` (`new Date().toISOString()`), not from the connector, since the connector data often lacks a reliable timestamp.
- **`tenantId`:** thread from the chat route (`user.tenantId`) via `runAgent` → `executeToolCall`. Today it is NOT threaded — this is the one required data-plumbing change.
- **`ttlMs`:** default constant exported from shared (e.g. live polls ~15 min = the `METRICS_POLL_INTERVAL_MS` default, demo longer), with an optional override field on the provenance schema so later phases can configure per-tenant without a contract version bump.
- **`completeness` / `confidence`:** best-effort per tool in Phase A; use the empty-shaped connector tools as `minimal`/low-confidence initially, refine in later phases.

## Risks

- **`packages/agent-core/tests/tools.test.ts`** has 14 assertions on raw `executeToolCall` output (`toContain('predicted_low_signal')`, `not.toContain('Tool desconocida')`, `toMatch(/No encontrado/)`, etc.). Any envelope wrapping changes the returned string and will break several of these — they must be updated in lockstep.
- **`packages/agent-core/tests/runtime.test.ts`** (4 tests) checks `result.toolCalls` shape and `dataSource` handling; forwarding extra context must not change the `ToolCallRecord`/`AgentResult` shape (`packages/shared/src/index.ts`). Keep `ToolCallRecord.result` as the enriched string (or raw) without changing the record/result types; do NOT modify `AgentResult`/`ChatResponse`.
- Changing the LLM-facing tool-result string may subtly shift model behavior (more JSON noise). Phase A must confirm responses still parse; runtime tests that match `[DEMO]`/system text should remain intact because `system.ts` and the source prompt are untouched.
- **`packages/shared/tests/contracts.test.ts`** baseline (9 tests) must keep passing; new `evidence.provenance.v1` tests are additive only.
- `apps/web` chat route currently drops `connectionId` into `runAgent`'s `dataSource` but not `tenantId`; adding tenant forwarding is required and touches `agent-core`'s `RunAgentOptions` type.

## Ready for Proposal

Yes. Recommend `/sdd-propose` next, recommending: contract as wrapping object, enrichment in `executeToolCall`, automatic `source` derivation, timestamp from the call, tenant threading, default `ttlMs`. Baseline verified: shared 9/9, agent-core 49/49 green.
