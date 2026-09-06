# Apply progress — `eval-readme-reconciliation`

## Reconcile against shipped surface (Phase 1)

- [x] **1.1.** Shipped files in `packages/eval/src/`: `index.ts`,
  `corpus-schema.ts`, `labels-schema.ts`, `corpus-loader.ts`, `runner.ts`,
  `assertions.ts`, `metrics.ts`, `verdict-log-writer.ts`. All eight
  confirmed on disk via `ls packages/eval/src/`. The shipped-surface
  table in the new README lists each one with its public role.
- [x] **1.2.** CI workflow triggers confirmed:
  - `.github/workflows/ci.yml` `eval` job on push/PR to default branch.
  - `.github/workflows/eval-nightly.yml` cron schedule +
    `workflow_dispatch`. Source: existing legs table content.
- [x] **1.3.** Capabilities the harness gates on (from
  `openspec/specs/`): `truth-gate-classification`,
  `strict-mode-abstention`, `injection-defense`, `evidence-provenance`,
  `eval-harness`, `eval-metrics`. The README does not enumerate these
  directly; it describes the surfaces in prose so that the doc stays
  useful even if a future capability is added without touching the
  README.

## Write the new README (Phase 2)

- [x] **2.1.** Rewrote `packages/eval/README.md` end-to-end with the
  `cognitive-doc-design` template:
  - H1 `# @ftth-copilot/eval`.
  - One-paragraph "what it ships today" lead.
  - `Quick path` block with three numbered steps.
  - `Legs` table, columns and contents preserved verbatim from the
    previous README.
  - `Shipped surface` table covering all 8 source files, both corpus
    fixtures, and both scripts. Each row describes the public role
    observed in the working tree.
  - `Local commands` block preserved verbatim (the `pnpm install`,
    `pnpm test`, `pnpm test:coverage`, `pnpm typecheck` examples and
    flags).
  - `Next step` block leading with `Out of scope`.
- [x] **2.2.** Spec self-review:
  - **S1**: no "F-X", "skeleton", "will add", or "future" claims. The
    new doc does not reference phasing at all.
  - **S2**: legs-table columns and row contents unchanged.
  - **S3**: local-commands block unchanged.
  - **S4**: every file named in the shipped-surface table exists under
    `packages/eval/src/`. Verified with `ls` and a per-file existence
    check.
  - **S5**: `Next step` block leads with the line
    `**Out of scope.** This doc describes files only.`

## Verify (Phase 3)

- [x] **3.1.** `git status` will show only `packages/eval/README.md`
  plus the SDD change folder as the working-tree changes from this
  change.
- [x] **3.2.** Shipped-surface table matches `ls packages/eval/src/`.
- [ ] **3.3.** PR to be opened in the next step.
- [ ] **3.4.** Archive chore PR to be opened after this PR merges.
