# Task: T2 — Detection pure-detector property suite

## Parent

`property-based-core.md`

## Status

pending

## Specs

S1, S2

## Allowed edit surfaces

- `packages/detection/tests/property/**`

## What

Property-based tests for the pure detectors of `@ftth-copilot/detection`, with every invariant declared explicitly and a fixed, reproducible seed.

## Details

- Candidate invariants to confirm against source before asserting (refine only if the source proves the stronger form false; record any refinement in your report):
  - D1 `median`, `mean`, `mad` are permutation-invariant over a multiset of finite numbers.
  - D2 `median`, `mean`, `mad` never mutate the input array.
  - D3 `median` of a non-empty list lies within `[min, max]`.
  - D4 `mad` is never negative and is `0` exactly when every value is equal.
  - D5 `fitTrend` returns `null` for fewer than two samples and for samples without time spread; otherwise `r2` lies in `[0, 1]`.
  - D6 `fitTrend` recovers the slope of a perfectly linear series (within a documented epsilon) and reports `r2 === 1`.
  - D7 every detector returns `null` or a `Finding` and never throws for arbitrary sample arrays (including empty and single-element arrays).
  - D8 every detector is deterministic when `now` is injected: two calls with identical input and identical `now` produce deeply equal output.
  - D9 every detector that produces a finding stamps `detectedAt` from the injected `now` (no ambient clock read).
  - D10 edge-case laws: `detectBaselineAnomaly` returns `null` for fewer than `minSamples` and for a flat history (MAD `0`); `detectTrafficAnomaly` returns `null` when the windowed average is at or below the threshold and reports `critical` only at or above twice the threshold; `detectLosEvents` severity ladder follows `criticalDelta`/`warningDelta`.
- Use `import fc from 'fast-check'` (the existing repo precedent in `packages/monitoring/tests/conformance/property-asn1.test.ts`).
- Declare every invariant in the test title (or an explicit invariant id like `D1`) so a failure names the law, not just the assertion.
- Use an explicit fixed seed per property (no random seed) and document the seed value in the file. Allow an explicit environment override only if it keeps the default seed fixed.
- Fixtures: synthetic only — invented tenant ids (`tenant-a`, `tenant-b`), invented device ids, documentation-range IPs if any IP is needed. No real data.
- Do not modify `packages/detection/src/**`. Do not commit.

## Deliverable

A green `packages/detection/tests/property/**` suite plus the observed test output.

## Commit

`test(detection): property-based invariants for pure detectors`
