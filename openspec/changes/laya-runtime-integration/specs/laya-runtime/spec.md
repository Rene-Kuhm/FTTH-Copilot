# Laya Runtime Integration — Spec

**Change**: `laya-runtime-integration`
**Date**: 2026-10-07
**Strict TDD**: true

---

## Purpose

Close the circuit between the Laya decision that is already produced
(`adaptive-router.ts:361-370`) and the metrics surface that is already published
(`prometheus.ts:313`), and make the ADR's four operating modes real at runtime.

## Requirements

### R1 — Single configuration truth

**R1.1** The system MUST resolve `LAYA_ENABLED`, `LAYA_MODE` and `LAYA_FAIL_OPEN` through exactly
one exported resolver.

**R1.2** `LAYA_ENABLED` MUST default to disabled. Laya MUST be considered enabled only when
`LAYA_ENABLED === 'true'`.

**R1.3** When enabled without an explicit mode, the system MUST default to `shadow`.

**R1.4** Every module that reads Laya configuration MUST delegate to the single resolver; no
module SHALL re-implement the defaulting.

### R2 — The decision is recorded

**R2.1** When Laya is enabled, the system MUST record each classification outcome into the Laya
metrics collector.

**R2.2** Recording MUST occur at the orchestration layer. `planRoute` SHALL remain free of
metrics side effects, preserving its documented purity
(`adaptive-router.ts:4-7`, `:353`).

**R2.3** Each routed query MUST be recorded exactly once.

**R2.4** The recorded `mode` label MUST be the resolved Laya mode
(`disabled|shadow|assisted|automatic`), SHALL NOT be the diagnostic route mode.

**R2.5** A classification failure MUST be recorded with `result: 'error'` rather than silently
swallowed.

**R2.6** When Laya is disabled, the system MUST NOT record anything and MUST NOT consult any
Laya source.

### R3 — The published metrics become real

**R3.1** After at least one recorded decision, `GET /api/metrics` MUST contain at least one
`ftth_laya_requests_total{...}` sample line.

**R3.2** The existing dashboard parser (`LayaMetricsPanel.tsx:39`) MUST match those samples
without modification.

**R3.3** The dashboard's operator instruction MUST be true: following it MUST change observable
behavior.

### R4 — The modes are distinguishable

**R4.1** In `disabled`, the system MUST bypass Laya entirely.

**R4.2** In `shadow`, the system MUST consult and record, and MUST NOT change the selected route.

**R4.3** In `assisted`, the system MAY change the route only when the Laya confidence satisfies the
configured thresholds.

**R4.4** In `automatic`, the system MAY let Laya select the route directly.

**R4.5** When the Laya service is unreachable and `failOpen` is true, the system MUST keep the
adaptive route, MUST record the failure, and MUST NOT throw.

**R4.6** When the Laya service is unreachable and `failOpen` is false, the system MUST fail closed
by propagating the error.

### R5 — The Laya modules are reachable

**R5.1** `packages/shared/src/index.ts` MUST export the Laya client and integration modules.

**R5.2** The package MUST NOT export two different functions under the same name. The
`recordLayaDecision` identifier SHALL resolve to exactly one signature.

**R5.3** Type checking MUST pass with the new exports, proving no ambiguous re-export.

### R6 — Failures are observable

**R6.1** When the circuit breaker transitions from closed to open, the system MUST emit an
observable signal (log and/or metric). The boolean returned by `recordFailure()` SHALL NOT be
discarded.

**R6.2** An inbound Laya response that fails `layaDecisionSchema` validation MUST be treated as a
transport failure, SHALL NOT be coerced into a synthesized decision.

**R6.3** The `LAYA_*` environment variables MUST be declared in `turbo.json` `globalEnv` so that
changing them invalidates cached tasks.

### R7 — Deployment and documentation reflect reality

**R7.1** `docker-compose.demo.yml` and `docker-compose.prod.yml` MUST be able to run the `laya`
service, and MUST pass the `LAYA_*` variables to the application service.

**R7.2** `.env.example` SHALL contain a single Laya block, and its `LAYA_URL` example MUST agree
with the port published by `docker-compose.yml` and the client fallback (`8080`).

**R7.3** ADR-042 and the README MUST state the runtime status that verification actually
established.

---

## Scenarios

### S1 — Shadow mode records without routing impact

- **Given** `LAYA_ENABLED=true` and `LAYA_MODE=shadow`
- **When** an operator query is routed through `runAgent`
- **Then** the Laya metrics collector SHALL contain one decision for the classified event class
- **And** the mode label SHALL be `shadow`
- **And** the resulting `DiagnosticRoute.mode` SHALL be identical to the value `planRoute` returned
- **And** `GET /api/metrics` SHALL contain a `ftth_laya_requests_total{mode="shadow",...}` sample

### S2 — Disabled is inert

- **Given** `LAYA_ENABLED` is unset or `false`
- **When** queries are routed
- **Then** the Laya metrics collector SHALL remain empty
- **And** no Laya source SHALL be consulted

### S3 — Classification failure is visible

- **Given** Laya is enabled and the expert classifier throws
- **When** the query is routed
- **Then** the request SHALL still complete (fail-open)
- **And** a decision SHALL be recorded with `result='error'`

### S4 — Assisted influences the route only above threshold

- **Given** `LAYA_MODE=assisted` and the configured confidence thresholds
- **When** Laya returns a decision whose confidence is below the low threshold
- **Then** the adaptive route SHALL be preserved

### S5 — Unreachable service degrades safely

- **Given** `LAYA_MODE=assisted` and `LAYA_FAIL_OPEN=true`
- **When** the Laya service does not respond
- **Then** the request SHALL complete with the adaptive route
- **And** the failure SHALL be recorded
- **And** no error SHALL propagate to the caller

### S6 — One config truth

- **Given** an identical environment
- **When** both loaders resolve their configuration
- **Then** the resolved `enabled` and `mode` values SHALL be equal

### S7 — Inbound validation

- **Given** a Laya HTTP response that does not satisfy `layaDecisionSchema`
- **When** the client maps it
- **Then** the client SHALL NOT return a synthesized decision
- **And** it SHALL follow the configured `failOpen` behavior

### S8 — Breaker opening is observable

- **Given** consecutive Laya failures reaching the configured threshold
- **When** the circuit opens
- **Then** the transition SHALL produce an observable signal

---

## Verification

- Unit tests per package with `vitest`.
- End-to-end acceptance: with `LAYA_ENABLED=true` and `LAYA_MODE=shadow`, `GET /api/metrics`
  returns at least one `ftth_laya_requests_total{...}` sample.
- Gates run with cache invalidated: `turbo run typecheck|lint|test --force`, plus
  `pnpm check:sources` and `pnpm check:contribution`.
