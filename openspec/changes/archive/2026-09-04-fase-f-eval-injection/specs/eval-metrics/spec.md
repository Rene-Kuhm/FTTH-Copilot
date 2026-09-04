# eval-metrics Specification

## Purpose

Defines nightly metric computation over `ConfirmedIncident`, `Message.toolCalls`, `AgentActionLog`, and `verdict_log`. Metrics cover coverage, abstention rate, and gate false-positives per tenant. Precision is TBD until the NOC tech lead labels `docs/validation/agent-qa-log.md` as ground truth.

## Requirements

### Requirement: Metric definitions

The metrics package MUST compute, per nightly run and per tenant:

| Metric | Numerator | Denominator |
|---|---|---|
| Coverage | Distinct `ConfirmedIncident.tenantId` referenced in `verdict_log` for that tenant | Distinct `ConfirmedIncident.tenantId` |
| Abstention rate | `Message.toolCalls` rows containing `__abstention__` | Total assistant messages |
| Gate FP | Runs where `finalize` flagged warn but the LLM text was correct per golden | Total warn-flagged runs |
| Precision | TBD | TBD |

#### Scenario: Coverage is computable from `ConfirmedIncident`

- GIVEN a tenant with 5 confirmed incidents and `verdict_log` referencing 3
- WHEN coverage runs
- THEN `coverage = 0.6`

#### Scenario: Abstention rate counts synthetic rows

- GIVEN 100 assistant messages and 7 with `__abstention__` in `toolCalls`
- WHEN abstention rate runs
- THEN `abstention_rate = 0.07`

#### Scenario: Gate FP requires golden

- GIVEN warn-flagged runs without a golden
- WHEN the metric runs
- THEN the FP slot is reported as `TBD` and does NOT block the run

### Requirement: Precision is TBD until labels exist

Until the NOC tech lead labels `docs/validation/agent-qa-log.md` as precision ground truth, `precision` MUST be reported as `TBD` in the nightly summary. The job MUST NOT fail on missing precision.

#### Scenario: Unlabeled QA log

- GIVEN `docs/validation/agent-qa-log.md` has no labels
- WHEN the nightly summary runs
- THEN `precision = "TBD"` and the job does not fail

### Requirement: Nightly leg with MiniMax-M3 only

The nightly workflow MUST use the MiniMax-M3 model exclusively. No key rotation, no additional providers. The workflow MUST live in a separate GitHub Actions file (not in the PR CI workflow).

#### Scenario: Workflow file location

- GIVEN the nightly workflow
- WHEN inspected
- THEN it lives at `.github/workflows/eval-nightly.yml` AND references `MINIMAX_API_KEY` only

### Requirement: Nightly thresholds are metrics-only

The nightly workflow MUST NOT fail the job on any metric value. Tenants with permissive Fase E knobs (`mode: 'observe'`, `abstainOnCodes: []`) MUST be allowed without error.

#### Scenario: Permissive tenant does not fail the job

- GIVEN a tenant with `mode: 'observe'`
- WHEN the nightly run reports
- THEN no error is raised AND the tenant's metrics are recorded

### Requirement: PR-time attack-pass-rate == 100%

The PR-time eval gate MUST fail the job when `attack-pass-rate < 1.0` on the red corpus. Coverage gaps on any of the 7 mapped surfaces MUST also fail the PR job. This is additive to the nightly metrics contract: PR gate is binary (pass/fail); nightly is observational.

#### Scenario: Coverage gap fails PR

- GIVEN a PR with one mapped surface missing a red case
- WHEN the eval job runs
- THEN the job fails with a coverage error
