# Task: T1 — Fast-check dev dependency in the four core workspaces

## Parent

`property-based-core.md`

## Status

pending

## Specs

S1, S7

## Allowed edit surfaces

- `packages/detection/package.json`
- `packages/evidence/package.json`
- `packages/shared/package.json`
- `packages/alerts/package.json`
- `pnpm-lock.yaml` (importer entries only)

## What

Declare `fast-check` as a devDependency of exactly the four workspaces that will import it, using the range already resolved in the lockfile, and refresh the lockfile minimally.

## Details

- Add `"fast-check": "^4.9.0"` to `devDependencies` of `packages/detection`, `packages/evidence`, `packages/shared`, `packages/alerts` (same range as `@ftth-copilot/monitoring`, resolved version `4.10.2`).
- Do not touch any `dependencies` block, no other workspace, no root `package.json`.
- Refresh the lockfile with `pnpm install --lockfile-only --prefer-offline`; the diff must be limited to importer entries for those four workspaces. If the resolver adds or changes any package resolution entry, stop and report it instead of accepting it.
- Do NOT run a full `pnpm install` (the parent owns the repository-wide install). Do not commit.
- Report the exact `git diff --stat` of the lockfile and the exact `pnpm` command output that proves the minimal change.

## Deliverable

Four updated workspace manifests plus a minimal lockfile diff, with the observed diff stat reported.

## Commit

`chore(test): add fast-check to core workspaces`
