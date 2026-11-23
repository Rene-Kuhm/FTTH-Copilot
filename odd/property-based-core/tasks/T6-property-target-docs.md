# Task: T6 — Documented test:property target and property-based testing guide

## Parent

`property-based-core.md`

## Status

pending

## Specs

S3

## Allowed edit surfaces

- `package.json` (root, `scripts` only)
- `turbo.json` (new `test:property` task entry only)
- `packages/detection/package.json`, `packages/evidence/package.json`, `packages/shared/package.json`, `packages/alerts/package.json` (`scripts` only)
- `docs/property-based-testing.md`
- `README.md` (one pointer line in the existing testing/commands section only)

## What

Make the property suite runnable through one documented command and explain the invariants, the seeds and how to reproduce a failure.

## Details

- Add a `test:property` script to the root `package.json` that runs the Turborepo task, add the matching `test:property` task entry to `turbo.json` (mirroring the existing `test` task shape: `dependsOn: ["^build"]`, `outputs: []`), and add a `test:property` script to each of the four workspace manifests so it runs only that workspace's `tests/property/**` suite.
- Write `docs/property-based-testing.md` in Spanish (the repository documentation language): what property-based testing buys here, the table of declared invariants per package (id, law, where it is asserted), the fixed seeds and how to reproduce a specific failure, and the exact commands.
- Add one pointer to the new document from `README.md` in the existing commands/testing section; do not restructure the README.
- Do not change any runtime behaviour, no dependency changes, no lockfile change.
- Do not commit.

## Deliverable

One documented command plus the guide, with the observed output of that command.

## Commit

`test: add test:property target and property-based testing guide`
