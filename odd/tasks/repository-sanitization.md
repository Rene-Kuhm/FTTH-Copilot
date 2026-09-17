# Repository Sanitization

## Objective

Remove the verified repository hygiene debt without discarding active work, and restore trustworthy runtime and CI behavior.

## Problem

The active adaptive-router branch contains a broken `direct` execution path, the final CI aggregator can accept non-success dependency results, and the working tree contains stale or unmanaged maintenance artifacts.

## Why

The repository must be safe to merge and maintain: direct requests need a real deterministic result, the required CI check must represent every dependency honestly, and project metadata must match the actual workspace.

## Authorized Scope

- Fix adaptive-router direct execution and strengthen its tests.
- Harden the CI aggregate gate and remove duplicate coverage execution.
- Reconcile `.gitignore`, `openspec/config.yaml`, stale OpenSpec artifacts, and stale documentation.
- Add repository-managed dependency update and CodeQL automation when it can be done without secrets.
- Inspect branch cleanup candidates locally; do not delete remote branches without explicit remote credential/session authorization.

## Constraints

- Preserve the active adaptive-router implementation and unrelated user work.
- Do not use remote credentials or mutate GitHub state without separate authorization.
- Keep artifacts and source text in English.
- Do not commit unless explicitly requested.
- Approximately 400 authored changed lines per task is an advisory review heuristic, not a cap.

## TDD Configuration

- Mode: strict TDD enabled.
- Source: `openspec/config.yaml` (`strict_tdd: true`) and `openspec/changes/adaptive-router/design.md`.
- Focused runner: `pnpm --filter @ftth-copilot/agent-core exec vitest run <test-file>`.
- Repository checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Tasks

- [x] **RS-1 — Repair adaptive-router direct mode**
  - Add a failing test that proves the selected connector tool executes, no LLM call occurs, a useful answer is returned, and `toolCalls`/`verdicts` are populated.
  - Implement the minimal deterministic direct path and retain TruthGate finalization.
  - Repair assisted mode so a tool call receives its single allowed follow-up synthesis instead of returning the max-iterations error.
  - Checks: focused adaptive-router/runtime tests; agent-core typecheck.

- [x] **RS-2 — Make CI aggregation fail closed**
  - Require every direct dependency result to equal `success`; reject `failure`, `cancelled`, and `skipped`.
  - Remove the duplicated full coverage invocation while retaining threshold enforcement.
  - Checks: parse workflow YAML; inspect expressions and script resolution.

- [x] **RS-3 — Reconcile repository metadata and local tooling**
  - Ignore `.codegraph/` as a local index.
  - Preserve and validate the existing `openspec/config.yaml` coverage corrections for all workspace projects.
  - Checks: workspace/config parity script; clean status excludes `.codegraph/`.

- [x] **RS-4 — Reconcile stale project documentation**
  - Remove or archive stale untracked diagnostic-router artifacts without losing completed design history.
  - Remove the obsolete `run-qa.py` TODO.
  - Checks: no stale active diagnostic-router task list; referenced QA script exists.

- [x] **RS-5 — Add bounded security maintenance automation**
  - Add low-noise Dependabot configuration for GitHub Actions. JavaScript dependency updates remain deferred because GitHub documents support only through pnpm 10 while this repository requires pnpm 11.22.0.
  - Add a CodeQL workflow for JavaScript/TypeScript with least-privilege permissions.
  - Checks: YAML parses; workflow/action configuration matches repository languages and package manager.

- [ ] **RS-6 — Run final verification and document residual remote work**
  - Run focused tests, lint, typecheck, unit tests, and build as applicable.
  - Record failures, skipped checks, and remote branch deletion candidates.
  - Confirm no unrelated working-tree content was removed.

## Acceptance Criteria

- Direct mode executes its selected tool and returns a deterministic answer with zero LLM calls.
- Assisted mode supports one tool round plus one synthesis call without exceeding its bounded budget.
- The aggregate CI check succeeds only when all required jobs report `success`.
- Coverage is not executed twice in the same unit-test job.
- `.codegraph/` no longer appears as untracked; OpenSpec project coverage matches the workspace.
- Completed diagnostic-router artifacts are no longer represented as an unchecked active change.
- The QA log contains no obsolete script TODO.
- Dependabot automation for GitHub Actions and CodeQL analysis are valid and bounded; unsupported pnpm 11 updates are not configured deceptively.
- All applicable checks and remaining remote-only work are reported honestly.

## Progress

- Current task: RS-6 (receipt review and remote-only cleanup remain).
- Completed: RS-1, RS-2, RS-3, RS-4, RS-5.
- Verification evidence:
  - Strict TDD for RS-1: initial RED produced 3 expected failures (direct initialized the LLM, skipped its tool, and assisted stopped before synthesis); disclosure RED then produced 1 expected failure for the missing `[DEMO]` prefix.
  - Focused adaptive-router suite: 10/10 passed. Full agent-core suite: 262/262 passed. Agent-core lint and typecheck passed.
  - Direct mode now covers ONU, OLT, PON, and CTO argument mapping; demo disclosure survives TruthGate finalization and live output remains unprefixed.
  - All 16 workspace projects passed direct ESLint and TypeScript checks using their installed binaries.
  - Package tests passed for 13/16 projects. Database tests require unavailable PostgreSQL on `localhost:5433`; monitoring and web SNMP tests require UDP bind permission unavailable in this environment.
  - Production build passed with `next build --webpack`. The default Turbopack build failed, including outside the sandbox, because its CSS worker could not bind a local port (`EPERM`).
  - PyYAML parsed `ci.yml`, `codeql.yml`, `dependabot.yml`, and `openspec/config.yaml`; assertions verified all six CI dependency results are required to equal `success`, only one coverage command remains, and the security automation uses the supported GitHub Actions ecosystem, intended language, permissions, and action majors.
  - Workspace/config parity matched all 16 projects; the corrected Mikrotik, eval, and web commands match their package scripts.
  - `git diff --check`, CodeGraph ignore/status checks, executable QA script check, obsolete TODO search, and stale OpenSpec path checks passed.
  - CodeGraph synchronized successfully and reports the index up to date.
  - Six obsolete local branches were removed after patch/tree equivalence checks; the active adaptive-router branch and `main` remain.
- Verification limitations:
  - Repository-managed automation cannot be execution-proven until GitHub runs it.
  - JavaScript dependency updates are explicitly deferred because official GitHub documentation currently lists Dependabot pnpm support through pnpm 10 while this repository declares pnpm 11.22.0.
  - The project pnpm wrapper could not verify/download pnpm 11.22.0 in the restricted network environment, so installed package binaries were used directly.
  - Three content-merged remote diagnostic-router branches remain; deleting them requires explicit destination/credential authorization.
- Native review: user consent was confirmed; four independent reviewer agents completed their inspections (risk/readability/reliability found no blocker; resilience found only advisory maintenance concerns). The native capture transition stopped because this shell runtime cannot submit provider-bound relay frames (`relay_transport_unavailable`); no source correction was requested.
- Next step: resolve remote branch cleanup authorization if desired; otherwise retain the three remote branches and report them as pending.
