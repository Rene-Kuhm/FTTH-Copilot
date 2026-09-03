# Tenant Policy Specification

## Purpose

Per-tenant override of Fase C/D module constants. One `TenantPolicy` row per `Tenant` (1:1, nullable). Absent → byte-identical to Fase C/D. Per-tenant wins over env over module default.

## Requirements

### Requirement: `TenantPolicy` envelope (`ftth.tenant-policy.v1`)

`packages/shared` MUST export `TENANT_POLICY_SCHEMA` and `tenantPolicySchema`. `packages/db` MUST define `TenantPolicy { id, tenantId @unique, schemaVersion, retrievalLimit?, retrievalSinceDays?, truthGateMode?, abstainOnCodes?, promotionMinAgeMs?, lastEvaluatedAt?, createdAt, updatedAt }` mapped to `tenant_policies`. Fields: `schema` literal `'ftth.tenant-policy.v1'`; `schemaVersion` literal `1`; `tenantId` non-empty string; `retrievalLimit` int `1..50`; `retrievalSinceDays` int `1..365`; `truthGateMode` enum `'observe'|'strict'`; `abstainOnCodes` array subset of `VerdictCode`; `promotionMinAgeMs` int `>= 0`; timestamps `z.string().datetime()`.

#### Scenario: Schema and field guards

- GIVEN `schema: '…v2'`, OR `retrievalLimit: 51`, OR `truthGateMode: 'off'`, OR `promotionMinAgeMs: -1`
- WHEN `safeParse` runs per case
- THEN each `.success === false`

### Requirement: Single resolution precedence

Per-knob precedence MUST be `tenantPolicy.X ?? env.X ?? moduleDefault.X`. For `truthGateMode`: `tenantPolicy.truthGateMode > process.env.TRUTH_GATE_MODE > DEFAULT_TRUTH_GATE_MODE`.

#### Scenario: Per-tenant wins; env fills absent

- GIVEN `tenantPolicy.truthGateMode: 'observe'` AND env `TRUTH_GATE_MODE=strict`
- WHEN `resolveTruthGateMode(policy)` runs
- THEN returns `'observe'`

- GIVEN no `TenantPolicy` row AND env `TRUTH_GATE_MODE=observe`
- WHEN `resolveTruthGateMode(undefined)` runs
- THEN returns `'observe'`

### Requirement: Absent `TenantPolicy` = Fase C/D byte-identical

When no row exists, every seam MUST fall back to the existing module constant. The 616 existing tests MUST pass unmodified.

#### Scenario: All seams fall back

- GIVEN `tenantPolicy = undefined`
- WHEN `shouldAbstain`, `retrieveRelevantIncidents`, `eligibleForPromotion` each run with no policy
- THEN outputs are byte-identical to the pre-Fase-E baseline

### Requirement: `shouldAbstain(verdicts, mode, tenantPolicy?)` extension

`abstention-policy.ts` MUST add a 3rd optional `tenantPolicy?` arg. `undefined` = Fase C byte-identical. Defined (possibly empty) = trigger on those codes instead of `['incomplete']`. Empty array `[]` MUST mean "never abstain".

#### Scenario: Override and disable

- GIVEN `abstainOnCodes: ['stale']` AND one `stale` verdict
- WHEN `shouldAbstain(verdicts, 'strict', policy)` runs
- THEN returns `'abstain'`

- GIVEN `abstainOnCodes: []` AND one `incomplete` verdict
- WHEN called
- THEN returns `'allow'`

### Requirement: `retrieveRelevantIncidents(args, tenantPolicy?)` extension

`relevant-incidents.ts` MUST add a 2nd optional `tenantPolicy?` arg. `limit` and `sinceDays` MUST resolve as `args.X ?? tenantPolicy.X ?? moduleDefault.X`.

#### Scenario: Per-tenant knobs apply

- GIVEN `retrievalLimit: 10` AND 12 candidates above threshold
- WHEN called
- THEN output capped at `10`

- GIVEN `retrievalSinceDays: 30` AND rows at `now - 60d` and `now - 10d`
- WHEN called
- THEN only `now - 10d` is returned

### Requirement: `eligibleForPromotion(c, src, now, hasIncomplete, tenantPolicy?)` extension

`pending-incident.ts` MUST add a 5th optional `tenantPolicy?` arg. `promotionMinAgeMs` resolves as `tenantPolicy.X ?? PROMOTION_MIN_AGE_MS` (Fase D archive §1 pre-approved this shape).

#### Scenario: Three gate durations

- GIVEN `tenantPolicy` undefined / `promotionMinAgeMs: 60_000` / `promotionMinAgeMs: 259_200_000`
- AND incidents resolved 25h / 30s / 25h ago
- WHEN `eligibleForPromotion` runs per case
- THEN returns `true` / `false` / `false`

### Requirement: Chat route per-turn loader

`apps/web/app/api/chat/route.ts` MUST load `TenantPolicy` once per turn, parallel with `resolveTenantConnector` and the confirmed-incident read. Threaded into `runAgent(opts)` (new `tenantPolicy?: TenantPolicy` on `RunAgentOptions`) AND the `retrievalProvider` closure.

#### Scenario: Single DB read, threaded through

- GIVEN a chat request
- WHEN the route runs
- THEN exactly one `prisma.tenantPolicy.findUnique({where: {tenantId}})` fires, parallel with connector resolution and confirmed-incident window read

- GIVEN `retrievalLimit: 7`
- WHEN the closure invokes `retrieveRelevantIncidents`
- THEN output ≤7 rows

### Requirement: Batch promotion loader

`promotePendingIncidents(now, policyLoader?)` MUST accept an optional `policyLoader: (tenantIds: string[]) => Promise<Map<string, TenantPolicy>>`. Default issues one `prisma.tenantPolicy.findMany({where: {tenantId: {in: tenantIds}}})` and groups in a `Map`. Per-candidate lookup is `O(1)`.

#### Scenario: Batched load avoids N+1

- GIVEN 10 eligible candidates across 4 tenants
- WHEN `promotePendingIncidents(now)` runs
- THEN at most one `tenantPolicy` query fires

### Requirement: Precedence logging

When a per-tenant override applies, emit exactly one `console.info` per resolved knob with `tenantId`, knob name, and value. Absent `tenantPolicy` → no line.

#### Scenario: Override emits info line

- GIVEN `tenantPolicy.truthGateMode: 'observe'` AND env `TRUTH_GATE_MODE=strict`
- WHEN the route resolves the mode
- THEN one `console.info('[ftth-copilot/tenant-policy] tenantId=t1 knob=truthGateMode value=observe')` is emitted