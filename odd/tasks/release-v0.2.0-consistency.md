# Release v0.2.0 Consistency

## Objective

Prepare a corrective v0.2.1 patch release after the v0.2.0 multiplatform release exposed metadata inconsistencies.

## Problem

The published v0.2.0 release contains desktop artifacts named 0.1.1, while Tauri and Android metadata still identify older versions. The changelog and desktop build documentation also omit the v0.2.0 release.

## Why

Users must be able to identify the installed artifact, source release, and documented build output as the same version. Incorrect metadata weakens upgrade behavior, support diagnostics, and release trust.

## Scope

- Align Tauri, Cargo, Android, and package-facing metadata to 0.2.1 for the corrective release.
- Update the changelog and desktop/Android distribution documentation.
- Add a deterministic consistency check so future releases cannot publish mismatched native versions.
- Investigate and document the local Next.js build discrepancy without weakening CI or masking failures.

## Constraints

- Do not rewrite or delete the already-published v0.2.0 release.
- Preserve unsigned-artifact disclosure and the current GitHub Releases distribution model.
- Keep each work unit independently reviewable; split changes if the review budget is exceeded.
- No source behavior changes beyond release metadata and validation.

## Authorized Scope

User authorized correction of all findings from the FTTH-Copilot RDD audit.

## Acceptance Criteria

- Native metadata and generated artifact names resolve to 0.2.1 for the corrective release.
- CHANGELOG and distribution docs describe v0.2.1 and current signing limitations accurately.
- A check fails when package, Tauri, Cargo, or Android versions drift.
- Focused checks pass, and the local Next.js build discrepancy is either corrected or recorded with reproducible evidence.
- Main remains untouched until the work is reviewed through the repository PR flow.

## Tasks

- [x] RVC-1 Align native release metadata and add consistency coverage.
- [x] RVC-2 Update changelog and distribution documentation for v0.2.1.
- [x] RVC-3 Investigate and verify the local Next.js build discrepancy.
- [ ] RVC-4 Run focused verification, create the approved PR, and report any remaining release limitation.

## Verification Evidence

- Baseline: main at `8d61f6b`, tag `v0.2.0`, clean worktree.
- RDD assessment: full v0.1.1..v0.2.0 candidate exceeded native reviewer context; no review authority was created.
- CI evidence: PRs #212, #213, and #214 reported all required checks successful.
- Local baseline: 40 Vitest files, 378 tests pass outside sandbox; ESLint passes with one warning; TypeScript passes; Next build currently fails parsing `--showConfig`.
- RVC-1: `scripts/check-release-version.ts 0.2.1` passes and rejects the stale expected version `0.2.0`.
- RVC-3: `pnpm --filter @ftth-copilot/web build` passes outside the sandbox; the earlier failure was caused by sandbox IPC restrictions. Android build remains unavailable locally because `JAVA_HOME`/Java is not installed; `cargo check` passes for Tauri v0.2.1.

## Next Step

Complete RVC-3 by reproducing or isolating the local Next.js build discrepancy, then run focused verification before opening the PR.
