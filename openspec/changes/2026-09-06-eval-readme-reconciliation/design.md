# Design — `eval-readme-reconciliation`

This design selects the **shape** of the new `packages/eval/README.md`. It
follows the `cognitive-doc-design` skill (lead with the answer, progressive
disclosure, recognition over recall, review empathy).

## Decision 1 — Drop the phase numbering; use a shipped-today paragraph

The original README leans on a phase ladder (`F-2 → F-4 → F-5 → F-6`) that has
been overtaken by the P1.x and P2.x series of work in the repo. Continuing to
reference F-X in the new doc would re-introduce the staleness this change is
trying to fix. The replacement is a single paragraph near the top of the doc
that describes what the package does **today**. Phases are for planning
documents, not for shipped READMEs.

## Decision 2 — Keep the PR/nightly legs table verbatim

The legs table at the top of the doc is **already correct** and was already
written in the same style as the rest of the shipped repo. Re-tabling it
introduces risk without benefit. The table moves up, just below the lead
paragraph, so it answers "which leg runs where, with or without keys" in five
seconds.

## Decision 3 — Replace the "Phase F-X will add …" block with a flat list of files

The future-promises block is the most concrete way the doc lies today — it names
files (`runner.ts`, `corpus-loader.ts`, `assertions.ts`, `metrics.ts`,
`verdict-log-writer.ts`) that exist on `main`. Re-phrasing these as "shipped
today" would still leave the doc heavy. The chosen shape is a flat, two-column
table — `File | Role` — which is faster to scan than prose and easier to keep
honest, because renaming a file in the future forces a doc rewrite only where
the file is named.

## Decision 4 — Add a `Out of scope` line

Per the `cognitive-doc-design` skill, the new doc ends with a `Next step`
block. To keep the reviewer path explicit, that block leads with `Out of
scope`, so a reviewer who only skims the diff does not have to read every
paragraph to know what is intentionally untouched.

## Decision 5 — Use `cognitive-doc-design` template, but let the local "Local commands" block stay

The `cognitive-doc-design` template includes a `Local commands`-style block,
which the original README already had. The new doc keeps the original block
content unchanged (spec S3) and folds it into the `Quick path` section so that
nothing about the reader's existing muscle memory changes — `pnpm test` still
works the same way, the README just gets a heading for the block and moves it
above the details.

## Out-of-scope design choices (intentional)

- We are **not** introducing a directory tree diagram. The package is small
  enough that the `File | Role` table communicates its shape.
- We are **not** cross-linking into `openspec/specs/eval-harness` from this
  README. The reader who needs the runtime contract should follow the
  capability name, but the first paragraph will name the capability once.
- We are **not** introducing a "Versioning" or "Changelog" section. The
  package's `package.json` and the repo's `CHANGELOG.md` already cover that
  surface; duplicating it in the README is exactly the kind of
  dual-source-of-truth that gets stale fastest.
