<!--
Pull request template for FTTH-Copilot.

Keep every section. If a section does not apply, write "Not applicable" and
say why: an empty section is indistinguishable from a forgotten one.
-->

## Context and motivation

<!--
The problem, not the solution: what an operator or engineer cannot do today,
what breaks, and why it matters now. Link the issue that tracks it.
-->

-

## Changes

<!--
What changed, grouped by area (agent, connectors, monitoring, web, CI, docs).
Name the packages, apps and documents you touched, and call out anything that
changes an existing contract: shared options, parsers, helpers, public API,
CLI flags, configuration format or persisted data.
-->

-

## Reviewer guide

<!--
Where to start reading, what to check, and where the risk is. Point at the
files and the specific decisions a reviewer should verify. Say explicitly if
a part of the diff needs domain knowledge (SNMP, OLT vendors, LLM behavior).
-->

- **Start here**:
- **Check**:
- **Risky parts**:

## Evidence

<!--
Exact commands and their outcomes. A check that was not run must not be
reported as passing: list it as skipped or blocked, with the reason.

  pnpm lint
  pnpm typecheck
  pnpm test:coverage-check
  pnpm build

Add the applicable ones for the change (pnpm test:e2e, pnpm check:sources,
pnpm check:conflicts, pnpm check:contribution, pnpm test:conformance) and the
evidence the change produces (measurements, golden files, sanitized captures).
-->

| Check | Command | Result |
| ----- | ------- | ------ |
|       |         |        |

## Production checklist

<!--
Confirm each item explicitly. An unchecked item is a decision, not an
oversight: write the reason next to it.

- [ ] The diff contains no secrets, credentials, community strings or customer data.
- [ ] Tenant isolation is preserved in every query, event, cache key and persisted reference.
- [ ] Tests cover the changed behavior, and the diff contains no unrelated changes.
- [ ] User-facing and operational documentation was updated in the same change.
- [ ] Database, configuration, deployment and rollback effects are documented, or there are none.
- [ ] The commit and the pull request title follow Conventional Commits.
