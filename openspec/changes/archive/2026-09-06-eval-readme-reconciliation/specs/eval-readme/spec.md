# Spec — `eval-readme-reconciliation`

This spec defines the **observable contract** of `packages/eval/README.md` after
this change. It does not define the runtime behavior of the package — that is the
job of the `eval-harness` and `eval-metrics` capability specs, which are
unchanged by this change.

## S1 — README describes shipped reality, not planned reality

**Given** a contributor opens `packages/eval/README.md` on the default branch,
without prior knowledge of the package,

**When** they read the first paragraph under the title and the section following
the leg table,

**Then** that text:

- MUST NOT claim the package is a "skeleton" or "Phase F-X" state.
- MUST NOT list a file under a "will add" or "future" heading if the file
  currently exists under `packages/eval/src/`.
- MUST state, in plain prose, that the PR gate is enforced on every pull
  request through `.github/workflows/ci.yml`.
- MUST be readable in under one minute by someone who has not seen the package
  before.

## S2 — PR-gate and nightly-leg table is preserved

**Given** the existing PR-gate / nightly-leg comparison table at the top of the
README,

**When** this change is applied,

**Then** the table MUST remain with the same columns (`Leg`, `Runner`,
`Trigger`, `LLM keys?`, `Failure mode`) and the same row contents as on `main`
before the change.

## S3 — Local commands block is preserved

**Given** the existing `Local commands` block at the bottom of the README,

**When** this change is applied,

**Then** the block MUST remain with `pnpm install`, `pnpm test`,
`pnpm test:coverage`, and `pnpm typecheck` examples and their flags unchanged.

## S4 — Reviewer can verify the claim about shipped surface

**Given** a reviewer wants to confirm that the new README does not lie about
which files exist,

**When** they run `ls packages/eval/src/` from the repo root,

**Then** every file the README claims is "shipped today" MUST exist on disk
and the README MUST NOT claim a file that does not exist.

This is the only verification requirement; verification runs as the
`apply-progress.md` step "Verify shipped-surface claim" before PR.

## S5 — Out-of-scope note

**Given** the new README ends with a `Next step` block per the
`cognitive-doc-design` template,

**When** it does,

**Then** it MUST include an explicit `Out of scope` line that names
source files, CI workflows, spec/design documents, and other-package READMEs
as not changed by this PR, so that a reviewer does not have to grep the diff
to know what is intentionally untouched.

## Non-goals

- This change does not modify any code, schema, gate threshold, corpus
  fixture, or workflow file.
- This change does not introduce new test cases or new documentation pages
  outside `packages/eval/README.md`.
- This change does not change the tone of the rest of the repo's READMEs.
