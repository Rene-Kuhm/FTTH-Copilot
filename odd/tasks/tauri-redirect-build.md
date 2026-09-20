# Tauri redirect build consistency

## Objective

Make every local and CI Tauri desktop build generate the required `dist/index.html` redirect before packaging, preventing `asset not found: index.html`.

## Problem

`tauri.conf.json` uses the ignored `apps/web/dist` directory as `frontendDist`, while CI creates `dist/index.html` manually and local `beforeBuildCommand` only runs `pnpm build`. Local AppImage/.deb builds can therefore package no entrypoint.

## Why

The Linux AppImage reported `asset not found: index.html`. The repository should have one source of truth for the generated redirect instead of relying on a CI-only heredoc.

## Scope

- Add a reusable redirect-generation command in `apps/web`.
- Invoke it automatically before local Tauri builds.
- Replace duplicated Linux/Windows CI heredocs with the shared command.
- Correct the desktop build documentation and add a fail-fast entrypoint check.
- Do not change the runtime architecture: the packaged redirect still targets `http://localhost:3001`.

## Constraints

- Preserve the existing Next.js server requirement and Tauri `frontendDist: "../dist"` design.
- Keep `dist/` generated and ignored.
- No product behavior change outside desktop build reliability.
- No release/tag changes in this task.

## Tasks

- [x] TBR-1 Add the shared redirect generator and wire it to Tauri build scripts.
- [x] TBR-2 Use the shared generator in Linux and Windows CI and fail fast if the entrypoint is missing.
- [x] TBR-3 Update desktop build documentation and verify local generation/build checks.

## Authorized scope

- Repository: `Rene-Kuhm/FTTH-Copilot`
- Branch: `fix/tauri-redirect-build`
- User authorization: implement the repository fix; publish through PR and merge only after green checks.

## Acceptance criteria

- `pnpm --dir apps/web run tauri:prepare` creates `apps/web/dist/index.html` deterministically.
- `pnpm --dir apps/web run tauri:build:linux` and `tauri:build:windows` prepare the redirect automatically.
- CI uses the shared command rather than duplicated inline HTML.
- Missing `dist/index.html` fails before Tauri packaging.
- Documentation no longer claims the generated file is tracked in Git.
- `git diff --check` and focused functional checks pass.

## Checks

- Resolved TDD mode: disabled/not configured; ordinary functional checks.
- Local checks: redirect generator, entrypoint assertions, package script validation, `git diff --check`.
- CI checks: Linux and Windows Tauri jobs, standard repository checks.

## Progress

- Exploration complete: the failure is caused by CI-only redirect generation.
- TBR-1 complete: `scripts/prepare-tauri-webview.mjs`, `tauri:prepare`, and the Tauri `beforeBuildCommand` now generate and verify the entrypoint.
- TBR-2 complete: Linux and Windows CI now call `pnpm tauri:prepare` instead of duplicating the HTML heredoc.
- TBR-3 complete: desktop docs now describe the generated ignored entrypoint; local `.deb` and AppImage builds passed.
- Next step: create the implementation PR after final review.

## Rationale

Centralizing the generated entrypoint removes environment-dependent build behavior while preserving the current localhost-backed desktop architecture.
