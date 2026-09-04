# Delta for confirmed-incident-memory

## ADDED Requirements (Fase E)

### Requirement: Per-tenant `promotionMinAgeMs` and retrieval knobs extend eligibility + retrieval

`packages/evidence/src/pending-incident.ts` MUST extend `eligibleForPromotion(candidate, sourceIncident, now, hasIncomplete, tenantPolicy?)` with a 5th optional argument. `promotionMinAgeMs` MUST resolve as `tenantPolicy.promotionMinAgeMs ?? PROMOTION_MIN_AGE_MS` (24h baseline). `packages/evidence/src/relevant-incidents.ts` MUST extend `retrieveRelevantIncidents(args, tenantPolicy?)` with a 2nd optional argument. `limit` MUST resolve as `args.limit ?? tenantPolicy.retrievalLimit ?? DEFAULT_LIMIT`; `sinceDays` MUST resolve as `args.sinceDays ?? tenantPolicy.retrievalSinceDays ?? DEFAULT_SINCE_DAYS`. Absent `tenantPolicy` → Fase D byte-identical behavior. The `ConfirmedIncident` envelope (`ftth.confirmed-incident.v1`), the `RELEVANT_INCIDENTS_HEADING` Spanish block, the `PendingIncidentCandidate` write gate (`result.abstained !== true` AND no `incomplete` verdict), and the `promotePendingIncidents(now)` helper signature extension MUST remain compatible with the Fase D baseline. Fase D archive forward-note §1 pre-approved this shape.

#### Scenario: Absent `tenantPolicy` = Fase D 24h gate

- GIVEN `tenantPolicy = undefined` AND incident resolved 25h ago AND `hasIncomplete: false`
- WHEN `eligibleForPromotion(c, src, now, false, undefined)` runs
- THEN returns `true` (Fase D byte-identical)

#### Scenario: Tenant-specific 60 000 ms = 1 minute gate

- GIVEN `tenantPolicy.promotionMinAgeMs: 60_000` AND incident resolved 30s ago
- WHEN `eligibleForPromotion(c, src, now, false, policy)` runs
- THEN returns `false`

#### Scenario: Tenant-specific 259 200 000 ms = 72 h gate

- GIVEN `tenantPolicy.promotionMinAgeMs: 259_200_000` AND incident resolved 25h ago
- WHEN `eligibleForPromotion(c, src, now, false, policy)` runs
- THEN returns `false`

#### Scenario: `promotionMinAgeMs = 0` allows immediate

- GIVEN `tenantPolicy.promotionMinAgeMs: 0` AND incident resolved 1s ago
- WHEN `eligibleForPromotion(c, src, now, false, policy)` runs
- THEN returns `true`

#### Scenario: Per-tenant retrieval limit overrides `DEFAULT_LIMIT`

- GIVEN `tenantPolicy.retrievalLimit: 10` AND `args.limit: undefined` AND 12 candidate rows above `MIN_SPARSESCORE`
- WHEN `retrieveRelevantIncidents(args, policy)` runs
- THEN output length `≤ 10` (not 5)

#### Scenario: Per-tenant retrieval window overrides `DEFAULT_SINCE_DAYS`

- GIVEN `tenantPolicy.retrievalSinceDays: 30` AND `args.sinceDays: undefined` AND rows at `now - 60d` and `now - 10d`
- WHEN called
- THEN only the `now - 10d` row is returned (the 60d row is outside the 30d window)

#### Scenario: Args win over tenant policy

- GIVEN `tenantPolicy.retrievalLimit: 10` AND `args.limit: 3` AND 12 candidate rows
- WHEN called
- THEN output length `≤ 3` (caller's arg wins)

#### Scenario: `promotePendingIncidents(now, policyLoader?)` batched load

- GIVEN 10 eligible candidates across 4 tenants
- WHEN `promotePendingIncidents(now)` runs
- THEN at most one `prisma.tenantPolicy.findMany({where: {tenantId: {in: [...]}}})` call fires; per-candidate policy lookup is `O(1)` from the populated `Map<tenantId, TenantPolicy>`

#### Scenario: Pending-candidate write gate stays Fase D

- GIVEN a clean (non-abstained, no `incomplete` verdict) live run
- WHEN the chat route persists
- THEN exactly one `PendingIncidentCandidate` row is written, regardless of `tenantPolicy` presence (the write gate is unaffected by Fase E)

#### Scenario: Confirmed-incident envelope unchanged

- GIVEN an operator confirm or agent promotion
- WHEN the `ConfirmedIncident` row is built
- THEN the envelope matches `ftth.confirmed-incident.v1` byte-identically; `tenantPolicy` is not a field on the envelope

#### Scenario: `RELEVANT_INCIDENTS_HEADING` byte-identical

- GIVEN the Fase D golden snapshot
- WHEN `RELEVANT_INCIDENTS_HEADING` is read after Fase E merges
- THEN bytes match exactly (including the "contexto, no evidencia" marker)