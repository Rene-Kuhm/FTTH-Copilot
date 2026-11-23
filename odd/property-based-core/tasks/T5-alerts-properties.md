# Task: T5 — Alerts tenant-isolation property suite

## Parent

`property-based-core.md`

## Status

pending

## Specs

S1, S2

## Allowed edit surfaces

- `packages/alerts/tests/property/**`

## What

Property-based tests for alert correlation and deduplication in `@ftth-copilot/alerts`, centred on tenant isolation.

## Details

- Candidate invariants to confirm against source (refine only with source proof; report refinements):
  - A-1 `correlateAlerts` never mixes alerts of different tenants into one incident: every returned incident carries the tenant id of its own alerts.
  - A-2 `correlateAlerts` requires the configured number of distinct finding kinds and otherwise emits no incident.
  - A-3 the severity of an incident is the maximum severity of its alerts.
  - A-4 `firstSeenAt`/`lastSeenAt` of an incident are the minimum/maximum timestamps of its alerts.
  - A-5 `reconcile` stamps the tenant id and connection id from its metadata onto every record it produces, and never writes a record of another tenant.
  - A-6 `groupRows` is order-independent, drops rows with a null value or unknown status text, and never mixes two device keys in one series.
  - A-7 `findingKey` is stable and injective over distinct kind/deviceKind/deviceId triples.
- If the source contradicts A-1 (alerts of two tenants with the same device key being merged into one incident), do NOT weaken the invariant silently: report the exact failing case and the source line as a defect finding, keep the rest of the suite green, and state the deviation in your report.
- Use `import fc from 'fast-check'`; declare every invariant explicitly; use an explicit fixed seed per property and document it.
- Fixtures: invented tenant ids (`tenant-a`, `tenant-b`), invented device ids.
- Do not modify `packages/alerts/src/**`. Do not commit.

## Deliverable

A green `packages/alerts/tests/property/**` suite plus the observed test output.

## Commit

`test(alerts): property-based tenant isolation invariants`
