# Repository Presentation

## Objective

Turn the repository's first screen into an enterprise product overview without changing production code.

## Problem

FTTH-Copilot's technical depth is documented, but the repository metadata and README lead with implementation details instead of the product problem, operational value, and current NOC/SOC capabilities.

## Why

Operators, partners, and prospective customers should understand the product's scope within thirty seconds while engineers retain direct access to installation and architecture details.

## Authorized Scope

- Update GitHub About text and repository topics.
- Redesign the README opening as an enterprise landing page.
- Add a repository hero asset and public roadmap.
- Add contribution and security policies.
- Move the completed root tracker into engineering documentation.
- Preserve the proprietary license unchanged.

## Constraints

- Do not modify production code under `apps/` or `packages/`.
- Keep technical artifacts in English unless extending existing Spanish documentation.
- Do not set a homepage without an approved destination URL.
- Do not publish a release without an approved version and release notes.
- Do not generate or imply a product demo that was not actually recorded.

## Tasks

- [x] **RP-1 — Reframe the README opening**
  - Add the product headline, value proposition, hero, Why section, and capability summary before installation.
  - Unify naming as “Organic Diagnostic Router — adaptive routing engine”.

- [x] **RP-2 — Add a technical hero asset**
  - Add a 1200×630 architecture-oriented image suitable for GitHub and social previews.
  - Reference it from the README.

- [x] **RP-3 — Publish repository guidance**
  - Add `ROADMAP.md`, `CONTRIBUTING.md`, and `SECURITY.md`.
  - Keep statements aligned with actual workflows and proprietary licensing.

- [x] **RP-4 — Clean the repository root**
  - Move `TRACKER_P2_1_FEC.md` to `docs/engineering/`.
  - Repair any links or references.

- [x] **RP-5 — Update GitHub repository metadata**
  - Replace the outdated About description.
  - Add relevant repository topics.
  - Leave homepage and releases pending explicit product decisions.

- [x] **RP-6 — Verify and deliver**
  - Check Markdown links, asset dimensions, naming consistency, root layout, and diff hygiene.
  - Record deferred items and preserve the license unchanged.

## Acceptance Criteria

- The README communicates the product problem, value, and primary capabilities before installation steps.
- “Organic Diagnostic Router” and “adaptive routing engine” are presented as one concept.
- The hero asset renders from the repository.
- Public roadmap, contribution guide, and security policy are present and internally consistent.
- The root tracker is relocated without content loss.
- GitHub About and topics reflect the current product.
- Homepage, demo/GIF, release creation, and license changes are not fabricated or guessed.

## Progress

- Current task: maintainer review; automatic merge is explicitly disabled.
- Completed: RP-1 through RP-6.
- Evidence:
  - README now leads with enterprise positioning, a product hero, the operator problem, six capabilities, and the public naming “Organic Diagnostic Router — adaptive routing engine”.
  - Added `docs/assets/ftth-copilot-hero.png` (1730×909, approximately 1.9:1) and referenced it from the README.
  - Added `ROADMAP.md`, `CONTRIBUTING.md`, and `SECURITY.md`.
  - Moved the completed FEC tracker to `docs/engineering/TRACKER_P2_1_FEC.md` without content loss.
  - GitHub About and 16 topics now reflect the NOC/SOC, FTTH, AIOps, observability, and multi-vendor scope.
  - Local Markdown links resolve across the six changed documentation surfaces.
  - `git diff --check`, documentation-only scope, tracker relocation, naming, image inspection, and unchanged-license checks passed.
- Deferred deliberately:
  - Homepage: no approved landing URL.
  - Demo/GIF: no real demo recording was supplied or produced.
  - Release: no approved version semantics or release notes.
  - License: proprietary terms remain unchanged; GitHub's “Other” classification is expected.
- Delivery:
  - Issue [#202](https://github.com/Rene-Kuhm/FTTH-Copilot/issues/202) was created from the Maintenance form.
  - The repository owner explicitly approved the issue; labels are `type:chore` and `status:approved`.
  - Commit `24132ce` was pushed on `docs/enterprise-repository-presentation`.
  - PR [#203](https://github.com/Rene-Kuhm/FTTH-Copilot/pull/203) targets `main`, closes issue #202, and carries exactly one type label: `type:docs`.
  - The maintainer accepted a 504-line `size:exception`; the rationale is recorded in the PR because the repository does not currently define that protected label.
  - Both CI workflow runs and CodeQL completed successfully, including lint/typecheck, unit tests, PostgreSQL integration tests, build, Playwright E2E, eval gate, and aggregate CI success jobs.
- Next step: review the green PR and decide whether to merge it manually.
