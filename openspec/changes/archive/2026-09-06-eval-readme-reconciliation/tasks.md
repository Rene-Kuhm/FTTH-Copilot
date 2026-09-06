# Tasks — `eval-readme-reconciliation`

Tasks are grouped by phase and numbered hierarchically. Each task is sized to
fit in one working session.

## Phase 1 — Reconcile against shipped surface

- [ ] **1.1.** Confirm which files exist under `packages/eval/src/` on `main`,
  and the public role of each. Capture the result as a `File | Role`
  two-column list.

- [ ] **1.2.** Confirm which CI workflow files reference the eval leg.
  Capture the exact trigger conditions (`ci.yml` `eval` job on push/PR,
  `eval-nightly.yml` cron + `workflow_dispatch`).

- [ ] **1.3.** Confirm the spec capabilities the eval harness gates on
  (`truth-gate-classification`, `strict-mode-abstention`, `eval-harness`,
  `eval-metrics`).

## Phase 2 — Write the new README

- [ ] **2.1.** Write the new `packages/eval/README.md` using the
  `cognitive-doc-design` template and the structure decided in `design.md`:
  - H1 title.
  - One-paragraph "what it ships today" lead.
  - `Quick path` block with `pnpm install` → `pnpm test` → read the legs
    table.
  - `Legs` table (preserved verbatim from the existing README).
  - `Shipped surface` table (the `File | Role` list from task 1.1).
  - `Local commands` block (preserved verbatim).
  - `Next step` block leading with `Out of scope`.

- [ ] **2.2.** Self-review the new README against spec `S1`–`S5` in
  `specs/eval-readme/spec.md`:
  - S1: no "F-X" or "will add" claims.
  - S2: legs table columns and contents intact.
  - S3: local commands block intact.
  - S4: each file in the shipped-surface table exists under
    `packages/eval/src/`.
  - S5: the `Next step` block leads with `Out of scope`.

## Phase 3 — Verify and ship

- [ ] **3.1.** Run `git status` and confirm only `packages/eval/README.md`
  is changed inside `packages/eval/`. No other file under the repo should
  be modified by this PR.

- [ ] **3.2.** Run `ls packages/eval/src/` and verify the shipped-surface
  table matches disk reality.

- [ ] **3.3.** Open the PR with the body from the SDD proposal, link the
  change folder, and request a docs review.

- [ ] **3.4.** After the PR is reviewed and CI is green, archive the
  change folder in a follow-up
  `chore(sdd): archive 2026-09-06-eval-readme-reconciliation change folder`
  PR, following the pattern of commits `761665e` and `f2929a3` in the main
  branch history.

## Task definition of done

- All five spec scenarios (`S1`–`S5`) pass.
- Phase 1, 2, and 3 tasks are complete.
- PR is open, reviewed, and merged.
- `sdd-status` returns `archive` as the next step instead of `propose`,
  and the archive chore PR closes the change folder.
