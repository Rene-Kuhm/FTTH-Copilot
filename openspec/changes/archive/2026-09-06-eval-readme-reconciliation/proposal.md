# Proposal — `2026-09-06-eval-readme-reconciliation`

## Why

`packages/eval/README.md` is stale. It claims the package is in **Phase F-2 skeleton**
state ("only registers the package in the pnpm workspace and proves the barrel wiring is sound")
and teases `runner.ts`, `corpus-loader.ts`, `assertions.ts`, `metrics.ts` as **F-4 work**, plus
`verdict-log-writer.ts` and the chat-route write gate as **F-5**, plus `ci.yml` and
`eval-nightly.yml` wiring as **F-6**.

The git history and the package's own source tell a different story. The shipped evidence:

- The PR-gate and nightly legs table at the top of the README already documents both
  runners and their triggers (`ci.yml` `eval` job + `eval-nightly.yml` cron), which are
  F-6 surface area. F-6 is therefore shipped, not planned.
- `src/runner.ts`, `src/corpus-loader.ts`, `src/assertions.ts`, `src/metrics.ts` exist
  on `main` (F-4 shipped).
- `src/verdict-log-writer.ts` and the chat-route write gate are behind the P1.2 / P1.4
  pipeline work that has been merged already (PRs #80 and #82 in the repo history).
- The truth-gate, evidence-provenance and injection-defense specs that the eval
  package gates on are shipped P1.2–P1.4 work.

The doc's "current scope" claims contradict the working tree. A new contributor
reading it will assume the gate is not yet enforced, when it is. The doc also
trails off into a promise of future phases that have already landed. This is a
documentation-reconciliation change: bring the README back in line with reality.

## What

Rewrite `packages/eval/README.md` so that:

1. The phase narrative is removed and replaced with a one-paragraph summary of what
   the package ships **today**, on `main`.
2. The PR-gate and nightly-legs table stays verbatim (it was already accurate).
3. The "Phase F-X will add …" future-promises section is replaced with a short,
   flat list of the files that already exist, each with the purpose that is true
   on `main`.
4. The local-commands block stays verbatim.
5. The result is scannable in under a minute by a reviewer who has not seen the
   package before. This means tables, a `Quick path` block at the top, and an
   `Out of scope` note for everything this doc does not promise.
6. The shape of the new doc follows the
   `cognitive-doc-design` skill template (lead with the answer, progressive
   disclosure, recognition over recall, review empathy).

This is a docs-only change. No source code is touched. No behavior, schema, gate
threshold, or workflow file changes.

## Scope

- In scope:
  - `packages/eval/README.md` (replaced; no new files).
- Out of scope:
  - Any source file under `packages/eval/src/`, `packages/eval/tests/`,
    `packages/eval/corpus/`, or `packages/eval/scripts/`.
  - Any CI workflow file (`.github/workflows/ci.yml`,
    `.github/workflows/eval-nightly.yml`).
  - Any spec or design document under `openspec/specs/`.
  - Any other package README in the monorepo.

## Rollback plan

Revert the single commit on the PR. The previous README is preserved in git
history. Because no source, schema, gate, or workflow is touched, the rollback is
also a no-op for CI — reverting is a pure documentation revert and takes effect
on the next deploy.

## Risk

- Low. Documentation-only. No runtime effect. No CI effect. No API effect.
- The only risk is that we accidentally describe a file that has drifted again by
  the time a future contributor reads the new README. Mitigation: include a
  short "shipped surface" pointer to the package directory, not a deep narrative,
  so that the doc is reasonable even if one file inside is renamed.
