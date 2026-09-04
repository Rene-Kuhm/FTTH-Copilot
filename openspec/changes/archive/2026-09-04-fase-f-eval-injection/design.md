# Design: Fase F — Permanent Evaluation + Injection Defense

## Technical Approach

Two legs, one gate. **PR leg (keyless, blocking)** — `packages/eval` is a vitest package that reuses `vi.mock('../src/llm')` + the `withToolResults` seam from `packages/agent-core/tests/runtime.test.ts:13-18,320-333`. The runner drives `runAgent` against a committable JSON corpus (`packages/eval/corpus/{pink,red}.json`), asserts `attack-pass-rate === 1.0`, and exits non-zero on any red bypass or surface-coverage gap. CI wires it as a new `eval` job in `.github/workflows/ci.yml` after `test-unit` (`if: always()`). **Nightly leg (MiniMax-M3, metrics-only)** — same corpus + a `ConfirmedIncident`-derived corpus lives in `.github/workflows/eval-nightly.yml` (NOT `ci.yml`). It reports coverage / abstention rate / gate FP per tenant; it NEVER fails the job. Permissive Fase E tenants (`mode: 'observe'`, `abstainOnCodes: []`) still run — they just produce higher abstention-rate / gate-FP numbers. **Warn consumption** — `finalize` in `runtime.ts:309-334` gains a `'warn'` branch: `result.text` stays byte-identical to the LLM text, `result.warnings?: VerdictCode[]` is populated, exactly one `AgentActionLog` row is written by the chat route with `toolName === '__injection_suspicion__'`, and `result.abstained` stays undefined. The `injection_suspicion_total` counter is derived nightly from `verdict_log` rows (no Prometheus dep).

## Architecture Decisions

| # | Decision | Alternative | Rationale |
|---|---|---|---|
| 1 | Corpus = committable JSON in `packages/eval/corpus/{pink,red}.json` (Node 22 JSON imports) | External corpus service, DB-backed corpus | Git-trackable, no infra, deterministic IDs; versioned with the code change. |
| 2 | Runner reuses `vi.mock('../src/llm')` + `withToolResults` from `runtime.test.ts` | New mock layer, MSW | Same seam unit tests already exercise → `AgentResult` shape proven; zero new test infrastructure. |
| 3 | `finalize` byte-identity on warn — `result.text` is the LLM string verbatim, no clone/format | Rebuild / annotate / clone text | `injection-defense.spec.md` Scenario "Warn preserves LLM text" demands it; cloning would silently change byte identity of every benign run. |
| 4 | Warnings channel = `AgentResult.warnings?: VerdictCode[]` only — NOT in `evidence.provenance.v1` envelope | Thread `warnings` through `executeToolCall` envelope | Envelope is a wire contract (8 keys, Fase A golden-tested); adding a 9th breaks Fase A test contract and the strict-mode-abstention invariant. |
| 5 | Permissive Fase E tenants run the PR corpus in full — CI does NOT special-case `mode: 'observe'` | Skip corpus when `abstainOnCodes: []` | The PR gate is binary on the red corpus; the corpus exercises the runner, not the per-tenant policy. Skipping would hide regressions in `finalize`. |
| 6 | `verdict_log` is a new Prisma table — additive, no backfill in v1 | Add `Message.verdicts Json?` | Spec explicitly defers the consolidation to Fase 2; log-table-first keeps `Message` schema byte-identical and avoids touching every read path. |
| 7 | Backfill via recompute over `Message.toolCalls[*].result` envelopes using existing `classifyEnvelope` / `classifyUnwrapped` | Replay LLM runs | Pure function over already-stored JSON → idempotent, deterministic, no API key. |
| 8 | PR `eval` job uses `if: always()` so lint/typecheck failures don't silently skip the gate | `needs: test-unit` only | `attack-pass-rate == 100%` is independent of unit failures; `if: always()` makes the gate always run and the final `ci-success` aggregator report honestly. |
| 9 | Nightly lives in `.github/workflows/eval-nightly.yml` (separate file) | Add a `nightly` job inside `ci.yml` | `ci.yml` runs on every push/PR — would burn LLM tokens; the separate file gets a `schedule:` trigger and the `MINIMAX_API_KEY` secret in scope only there. |
| 10 | MiniMax-M3 only for nightly v1 | Multi-provider rotation | Spec scope decision; one provider keeps the threshold definition clean. Cross-model expansion is Fase F-2. |
| 11 | `injection_suspicion_total` counter = derived metric from `verdict_log` rows (per-tenant, `code IN ('stale','low_confidence')`) | New Prometheus counter | No infra dep, recomputable on backfill, identical numbers to a counter increment given the persist-once contract. |
| 12 | NOC labels live in a parallel file `docs/validation/agent-qa-log.labels.csv` referenced from `agent-qa-log.md` | Mutate the log directly | Decouples labels from prose; reviewer edits CSV without risking prose drift; CSV remains diff-friendly for PR review. |

## Data Flow

```
PR CI (keyless)                          Nightly (MINIMAX_API_KEY)
─────────────                            ─────────────────────────
ci.yml → eval job                        eval-nightly.yml → scheduled
   │                                        │
   ▼                                        ▼
packages/eval/src/runner.ts            packages/eval/src/runner.ts
   │  loads corpus/pink.json              │  loads corpus/{pink,red}.json
   │  loads corpus/red.json                │  loads ConfirmedIncident corpus
   │                                        │
   ▼                                        ▼
vi.mock('../src/llm') ← scripts        createLlmClient() real provider
   │                                        │
   ▼                                        ▼
withToolResults(stub executeToolCall)   withToolResults(stub executeToolCall)
   │                                        │
   ▼                                        ▼
runAgent(opts) — finalize fires:        runAgent(opts) — finalize fires:
   allow → { text, toolCalls, verdicts }    allow → same
   warn  → { text, warnings, verdicts }     warn  → same
   abstain → { abstained, abstention,      abstain → same
               text (rendered) }
   │                                        │
   ▼                                        ▼
assertions/attack-pass-rate.ts          metrics/nightly-report.ts
   • red cases: gate fired?                 • coverage (verdict_log vs ConfirmedIncident)
   • pink cases: never fail                 • abstention rate (__abstention__ rows / total)
   • surface coverage (≥1 red per surface)  • gate FP (warn vs golden, TBD until labels)
   • coverage gap → exit 1                  • write report to logs
   │
   ▼
verdict-log-writer.ts (PR only)
   writes red-case verdicts → verdict_log (keyless path can use
   in-memory + assertion; production persist lives in chat route)

ci.yml exit code → PR gate               No exit-code gate (observational)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/eval/src/runner.ts` | NEW | Drives `runAgent` per corpus entry with mocked LLM; returns `{result, expected}` for the assertion layer. |
| `packages/eval/src/corpus-loader.ts` | NEW | Loads + zod-validates `corpus/{pink,red}.json`; stable-id dedup. |
| `packages/eval/src/assertions.ts` | NEW | Per-`expected` gate: `refuse` / `abstain` / `warn-flag`; surface-coverage report. |
| `packages/eval/src/metrics.ts` | NEW | Nightly report builder over DB rows (coverage, abstention rate, gate FP). |
| `packages/eval/src/verdict-log-writer.ts` | NEW | Nightly-only; writes red-case verdicts into `verdict_log` for the recompute path. |
| `packages/eval/{vitest.config.ts,package.json,tsconfig.json,README.md}` | NEW | Package wiring (vitest path filter, `@ftth-copilot/agent-core` + `@ftth-copilot/evidence` deps). |
| `packages/eval/corpus/{pink,red}.json` | NEW | Committable JSON (schema in §Interfaces). Pink: benign traffic covering each of 7 surfaces. Red: ≥1 per surface with `expected` gate. |
| `packages/eval/tests/{runner,corpus-loader,assertions,metrics,verdict-log-writer}.test.ts` | NEW | Vitest RED-GREEN-REFACTOR suite. |
| `packages/agent-core/src/runtime.ts` | MODIFIED | `finalize`: when `shouldAbstain` returns `'warn'`, return `{text, toolCalls, verdicts, warnings}`. `'abstain'` branch unchanged. |
| `packages/agent-core/src/index.ts` | MODIFIED | Re-export `VerdictCode` if not already (consumed by `ChatResponse` extension). |
| `packages/agent-core/tests/runtime.test.ts` | MODIFIED | Add warn-tier byte-identity tests: `text` preserved, `warnings` populated, `abstained === undefined`, `buildAbstention` not called. |
| `apps/web/app/api/chat/route.ts` | MODIFIED | After `result` resolved: if `result.warnings` present, write one `AgentActionLog` row with `toolName: '__injection_suspicion__'`, `result: { warnings: [...] }`; write one `verdict_log` row per verdict (tenantId, conversationId, messageId pending `Message.create` — see below). |
| `apps/web/tests/api/chat-abstention.test.ts` | MODIFIED | Add `prismaVerdictLogCreate` mock + assertions for `__injection_suspicion__` row + `verdict_log` row per verdict. |
| `packages/db/prisma/schema.prisma` | MODIFIED | Add `verdict_log` model with `@@index([tenantId, observedAt])`. |
| `packages/db/prisma/migrations/<ts>_verdict_log/migration.sql` | NEW | Mirrors Fase E pattern (`20260903211301_tenant_policies/migration.sql`): `CREATE TABLE "verdict_log" ...` + indexes; no destructive change. |
| `packages/shared/src/contracts.ts` | MODIFIED | Add `verdictLogEntrySchema` zod (mirrors `confirmedIncidentSchema` style); add `VERDICT_LOG_SCHEMA` literal. |
| `packages/shared/tests/contracts.test.ts` | MODIFIED | Golden test for `verdictLogEntrySchema` (rejects empty `tenantId`, enforces `severity` enum). |
| `packages/shared/src/index.ts` | MODIFIED | Add `warnings?: VerdictCode[]` to `AgentResult` and `ChatResponse` (additive, optional). |
| `.github/workflows/ci.yml` | MODIFIED | New `eval` job after `test-unit` (`needs: [lint-and-typecheck, test-unit]`, `if: always()`); `secrets:` absent; exits non-zero on `attack-pass-rate < 1.0` or coverage gap. |
| `.github/workflows/eval-nightly.yml` | NEW | `schedule:` cron + `workflow_dispatch`; uses `MINIMAX_API_KEY` secret; runs `packages/eval` nightly runner against full corpus + `ConfirmedIncident` corpus; never fails. |
| `docs/validation/agent-qa-log.md` | MODIFIED | Add link to parallel labels file; brief note that until labeled, precision is `TBD`. |
| `docs/validation/agent-qa-log.labels.csv` | NEW | Per-Q columns: `id, expected_gate, label, notes`; NOC tech lead edits CSV, prose untouched. |
| `packages/evidence/README.md` | MODIFIED | Add Fase F section: warn-tier wiring + `verdict_log` reference. |
| `openspec/changes/fase-f-eval-injection/specs/{strict-mode-abstention,evidence-provenance,confirmed-incident-memory}/spec.md` | UNCHANGED in change | Merge into canonical `openspec/specs/...` at archive time. |

## Interfaces / Contracts

**Corpus JSON schema** (`packages/eval/corpus/{pink,red}.json`):

```ts
const verdictCodeSchema = z.enum(['ok', 'low_confidence', 'stale', 'incomplete']);
const corpusEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    surface: z.enum(['user_message', 'tool_result', 'customer_name_lookup',
                       'system_prompt_injection', 'retrieved_incident',
                       'multi_turn_history', 'untrusted_attachment']),
    kind: z.literal('pink'),
    query: z.string().min(1),
    tools: z.array(z.object({
      name: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()),
      response: z.string(),           // raw executeToolCall output
    })).optional(),
    expected: z.literal('allow').default('allow'),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    id: z.string().min(1),
    surface: z.enum([...]),
    kind: z.literal('red'),
    query: z.string().min(1),
    tools: z.array(...).optional(),
    expected: z.enum(['refuse', 'abstain', 'warn-flag']),
    metadata: z.record(...).optional(),
  }),
]);
```

**`AgentResult.warnings?: VerdictCode[]`** — additive to existing `AgentResult` / `ChatResponse` in `packages/shared/src/index.ts`. Backward compatible: omission = identical to pre-Fase-F.

**`verdictLogEntrySchema`** (in `packages/shared/src/contracts.ts`):

```ts
export const VERDICT_LOG_SCHEMA = 'ftth.verdict-log.v1';
export const verdictLogEntrySchema = z.object({
  schema: z.literal(VERDICT_LOG_SCHEMA),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  toolName: z.string().min(1),
  code: verdictCodeSchema,
  severity: z.enum(['ok', 'info', 'warning', 'critical']),
  observedAt: z.string().datetime(),
}).strict();
export type VerdictLogEntry = z.infer<typeof verdictLogEntrySchema>;
```

**Prisma `verdict_log` model**:

```prisma
model VerdictLog {
  id             String   @id @default(cuid())
  tenantId       String
  messageId      String
  conversationId String
  toolName       String
  code           String   // VerdictCode
  severity       String   // VerdictSeverity
  observedAt     DateTime
  @@index([tenantId, observedAt])
  @@map("verdict_log")
}
```

## Testing Strategy

`openspec/config.yaml` `rules.apply.tdd=true` applies at sdd-apply (not design). Layers:

| Layer | What | Approach |
|---|---|---|
| Unit (`packages/eval/tests/`) | Corpus loader (zod rejection, ID dedup), assertions (per gate, byte-identity), metrics (computed over fixture rows), verdict-log-writer | Pure vitest, no DB. |
| Integration (`packages/agent-core/tests/runtime.test.ts`) | `finalize` warn path: `text` byte-identical to LLM; `warnings` populated; `abstained === undefined`; `buildAbstention` not called (mocked + spy). Existing Fase A envelope key-count golden test must still pass unchanged. | Reuse `vi.mock('../src/llm')` + `withToolResults` pattern from lines 13-18 / 320-333. |
| Integration (`apps/web/tests/api/chat-abstention.test.ts`) | `__injection_suspicion__` `AgentActionLog` row written exactly once; one `verdict_log` row per verdict; `Message.content` byte-identical to LLM text (no abstraction wrapper). | Add `prismaVerdictLogCreate` mock; extend happy path. |
| E2E | Spec forbids Playwright as gate proof. A smoke e2e MAY exist for `verdict_log` UI surfacing, but not for the gate. | Optional. |

Byte-identity invariant for warn path is asserted by `expect(result.text).toBe(LLM_TEXT_LITERAL)` — not via JSON round-trip — so any silent formatter / clone would fail the test.

## Sequence Diagram

```
attacker userMessage ──▶ runner.ts ──▶ llm.createMessage (mocked)
                              │
                              ▼
                         executeToolCall (stubbed via withToolResults)
                              │
                              ▼ verdicts.push(classifyToolResult(...))
                         finalize(text)
                              │
              ┌───────────────┼───────────────┐
              │               │               │
            'allow'         'warn'         'abstain'
              │               │               │
              ▼               ▼               ▼
        {text,            {text,          {abstained,
         toolCalls,        toolCalls,      abstention,
         verdicts}         verdicts,       text (rendered),
                            warnings}      toolCalls,
                                            verdicts}
                              │               │
                              ▼               ▼
                    assertions.ts        (no-op for warn path)
                    gate expected?           (refuse/abstain tests pass)
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
        pass (exit 0)                   fail (exit 1)
                                                  │
                                                  ▼
                              ci.yml eval job → PR blocked
```

## Migration / Rollout

**v1 migration**: additive `verdict_log` table. SQL mirrors `20260903211301_tenant_policies/migration.sql` template — `CREATE TABLE` + `@@index` only; no destructive change. Existing migrations apply first (CI service container). No `Message` schema change → `Message.toolCalls[*].result` envelope bytes stay byte-identical. **Backfill** is a recompute job (`verdict_log` rows over `Message.toolCalls[*].result` envelopes via existing `classifyEnvelope` / `classifyUnwrapped`); idempotent; not in v1 scope but the table exists. **Rollback**: drop `verdict_log` table; revert `runtime.ts` finalize warn branch (Fase C behaviour restored for all tenants). PR eval job removal = `attack-pass-rate` gate disappears; nightly workflow removal = metrics go dark. **Fase 2 (out of scope)**: MAY consolidate `verdict_log` into `Message.verdicts Json?`. The log table is the v1 storage so consumers can rely on it without waiting for the consolidation.

## Threat Matrix

| Boundary | Applicable? | Reason |
|---|---|---|
| Routing (HTTP path manipulation) | N/A | Runner does not bind to a port; CI invokes vitest in-process. |
| Shell / subprocess | N/A | No `child_process`, no `exec`. |
| VCS / PR automation | N/A (CI workflow files only) | Workflow YAML edits are reviewed by the PR review pipeline; no automation beyond `gh`. |
| Executable-file classification | N/A | No new executables. |
| Process integration | N/A | Pure in-process vitest. |

`apply` TDD tasks add no Applicable row.

## Risks

| Risk | Likelihood | Design-level mitigation |
|---|---|---|
| Over-cautious gate (FP abstentions) | Medium | `warnings` channel is additive — Phase 1 wired to flag-and-log, NOT text replacement; precision reported nightly as `TBD` until labels exist. |
| Corpus overfit to mocks | Medium | Nightly MiniMax-M3 leg on real LLM uses identical corpus + `ConfirmedIncident` corpus; nightly reports divergence between mock-driven and real-model attack-pass-rates. |
| `finalize` byte-identity silently broken | Low | RED test asserts `expect(result.text).toBe(LLM_TEXT_LITERAL)` — not via JSON round-trip — so any future formatter/clone fails the test. |
| `verdict_log` schema drift from `evidence.provenance.v1` envelope | Low | Spec explicitly forbids envelope modification; `verdict_log` zod mirrors the existing column set (no envelope field copying). |
| PR CI cost creep (corpus grows) | Medium | Corpus is versioned, committable; runner has vitest timeout per case (≤500ms each → ≤30s total for ~50 cases). |
| Persistence migration cost on existing tenants | Low | Additive table, no destructive change; existing rows untouched. |
