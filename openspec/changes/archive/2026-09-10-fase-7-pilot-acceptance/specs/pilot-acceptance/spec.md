# Fase 7 — Pilot and Acceptance (Spec Delta)

## Why

Meet requirements 7.1 through 7.7 and Gate 7 of Roadmap Fase 7: Pilot tenant gating, frozen evaluation set, multi-dimensional metrics, strict acceptance criteria, manual fallback procedure, and zero-data-loss rollback.

## Scenarios (Given/When/Then)

### Scenario 7.1: Progressive Feature Enablement for Authorized Pilot Tenant

Given a tenant authorized for cognitive investigation pilot (`pilotAuthorized: true`)
When features are provisioned with progressive flags (`cognitiveInvestigation: true`, `snmpTraps: false`)
Then cognitive investigation runs are permitted for that tenant
  and unenabled features (e.g. `snmpTraps`) remain strictly disabled
  and an unauthorized tenant (`pilotAuthorized: false`) is rejected with a clear authorization refusal.

### Scenario 7.2: Frozen Evaluation Set and Execution Metadata Traceability

Given a held-out frozen evaluation dataset separate from development fixtures
When an evaluation run is executed
Then the evaluation result records: `modelVersion`, `promptVersion`, `rulesVersion`, `sources`, and `runtimeConfig`
  and the dataset satisfies its strict integrity schema (`ftth.pilot-frozen-eval.v1`).

### Scenario 7.3: Comprehensive Metric Computation Without Fabricated Precision

Given an evaluation run summary with mixed adjudicated labels and unadjudicated cases
When `computePilotMetrics` is invoked
Then it outputs:
  - `diagnosticAccuracy` computed strictly over adjudicated evaluable cases
  - `supportedClaimsRatio`
  - `abstentionRate`
  - `labelsCoverage`
  - `alertFalsePositiveRate`
  - `latencyP95Ms`
  - `estimatedCostUsd`
And when adjudicated cases are below minimum threshold, accuracy is flagged as insufficient rather than fabricated.

### Scenario 7.4: Distinct Time-to-Confirmed-Cause vs Time-to-Resolution

Given operational incident timestamps (`detectedAt`, `causeConfirmedAt`, `resolvedAt`)
When metrics are calculated
Then `timeToConfirmedCause` and `timeToResolution` are reported as distinct metrics with explicit sample size (N)
  and compared against the baseline with clear sample size caveats.

### Scenario 7.5 & 7.6: Strict Numerical Thresholds and Zero-Tolerance Hard Safety Gates

Given a pilot evaluation summary
When `evaluatePilotAcceptance` is executed
Then it fails acceptance if:
  - Any cross-tenant access occurs (`crossTenantAccessCount > 0`)
  - Any unauthorized NMS write action is attempted (`unauthorizedNmsActionsCount > 0`)
  - Any non-existent device/evidence reference is accepted (`nonExistentReferencesAcceptedCount > 0`)
  - Duration is less than 14 days or adjudicated sample size is under 50 cases.

### Scenario 7.7: Reversible Rollback With Zero Data Deletion

Given an active pilot with generated investigation versions and logs
When a rollback is triggered (feature flags disabled)
Then all future cognitive investigation requests immediately fall back to the manual SOP
  and existing historical records, logs, and telemetry remain intact per the retention policy.
