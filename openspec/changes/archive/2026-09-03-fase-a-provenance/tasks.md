# Tasks: Fase A — Provenance

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~230–260 |
| 800-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
800-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Full additive provenance enrichment end-to-end | PR 1 (single) | `turbo run test` | N/A: pure data-enrichment, no process boundary | Revert wrapper + threading; remove schema |

## Phase 1: Contrato & Helpers Puros (Foundation)

- [x] 1.1 RED: Add additive `describe('evidence.provenance.v1')` golden tests to `shared/tests/contracts.test.ts` (1 valid fixture + negative mutations: wrong schema, empty source, empty tenantId, bad observedAt, negative ttlMs, invalid completeness, confidence 1.5) asserting spec scenarios R1–S1..S9; verify baseline 9 still pass. `turbo run test` — new tests fail (schema missing).
- [x] 1.2 GREEN: In `packages/shared/src/contracts.ts` add `EVIDENCE_PROVENANCE_SCHEMA = 'evidence.provenance.v1'`, `evidenceProvenanceSchema` (z.literal schema; source/tenantId nonempty; observedAt `z.string().datetime()`; ttlMs nonnegative int; completeness enum; confidence 0..1 optional; data unknown), `DEFAULT_TTL_MS = 15*60_000`, `DEMO_TTL_MS = 60*60_000`. Re-export in `packages/shared/src/index.ts`.
- [x] 1.3 RED: Create `packages/agent-core/tests/provenance.test.ts` for pure helpers: `deriveSource` (predicted→curated; demo→`.demo`; live→`.poll`; sourceOverride wins), `defaultProvenance` (mode demo vs live TTL), `PROVENANCE_TOOL_META` per-tool completeness/confidence/ttl (per design table). Tests fail (helpers absent).
- [x] 1.4 GREEN: Create `packages/agent-core/src/tools/provenance.ts` with `deriveSource`, `defaultProvenance`, `PROVENANCE_TOOL_META` implementing per-tool table (get_onu_detail/get_onus_with_low_signal/search→partial 0.8; predictions→minimal 0.5 ttl 60000 CURATED_TTL_MS; rest complete 1.0 default TTL). `turbo run test` green.

## Phase 2: Wrapper & Threading (Core Implementation)

- [x] 2.1 GREEN+REFACTOR: In `packages/agent-core/src/tools/index.ts` add `ProvenanceContext` arg to `executeToolCall(connector, toolName, args, predictionProvider?, provenance?)`; wrap successful connector data into `JSON.stringify({ schema, source, tenantId, observedAt: new Date().toISOString(), ttlMs, completeness, confidence, data })` using helpers; keep null/'No encontrado'/unknown-tool/error paths unwrapped (per design edge cases).
- [x] 2.2 GREEN: In `packages/agent-core/src/runtime.ts` add aditivos `tenantId?: string`, `connectionId?: string` to `RunAgentOptions`; build `ProvenanceContext` from these + `dataSource.mode/provider` and pass to `executeToolCall`. No drift on `ToolCallRecord`/`AgentResult`/`ChatResponse`.
- [x] 2.3 GREEN: Export `ProvenanceContext`, `deriveSource`, `defaultProvenance` from `packages/agent-core/src/index.ts`.

## Phase 3: Threading App & Tests en Lockstep (Integration)

- [x] 3.1 GREEN: In `apps/web/app/api/chat/route.ts` pass `tenantId: user.tenantId` and `connectionId: resolved.dataSource.connectionId` to `runAgent`.
- [x] 3.2 RED→GREEN: Update `packages/agent-core/tests/tools.test.ts` in lockstep: the 7-row `it.each` (R4) assert envelope via `JSON.parse(result)` + `evidenceProvenanceSchema.safeParse`; `get_predicted_issues` asserts `source === 'curated'`; demo/live source suffix cases; `source` override; large payload intact under `data` (R8); completeness enum (R7). Keeps not-found/error/unknown unwrapped.
- [x] 3.3 GREEN: `packages/agent-core/tests/runtime.test.ts` — assert envelope under `toolCalls[].result` and no drift on `AgentResult`/`ChatResponse` shapes (R5).

## Phase 4: Verificación (Testing)

- [x] 4.1 Run `turbo run test` workspace; confirm shared (9 baseline + new golden), agent-core (49 + updated), all green; no drift in `llm.ts`/`prompts/system.ts` (untouched).

## Coverage Map (requirements → tasks)

- R1 contrato → 1.2; R2 golden → 1.1; R3 enrichment → 2.1; R4 contexto → 2.1; R5 threading → 2.2, 3.1; R6 ttl → 1.2, 1.4; R7 completeness/confidence → 1.4, 2.1; R8 datos grandes → 3.2.
