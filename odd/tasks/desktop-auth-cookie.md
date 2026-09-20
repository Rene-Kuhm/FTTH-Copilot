# Desktop authentication cookie

## Objective

Make FTTH-Copilot desktop login persist a valid session when the packaged Tauri app loads the local Next.js runtime over `http://localhost:3001`, without weakening Secure cookies for HTTPS production deployments.

## Problem

The login endpoint accepts valid credentials, but the session cookie is emitted with `Secure` because `next start` runs with `NODE_ENV=production`. The desktop WebView uses plain local HTTP, so the cookie is not sent on the subsequent `/api/auth/me` request and the UI returns to the login selector.

## Why

The v0.2.1 desktop release is unusable for authenticated local testing even though the account and backend are healthy.

## Scope

- Adjust cookie security policy for the explicitly local desktop HTTP runtime.
- Add regression coverage for local HTTP and HTTPS/production behavior.
- Align version metadata and release documentation for the patch release.
- Verify the packaged login flow and release checks.

## Constraints

- Preserve `Secure` cookies for HTTPS production deployments.
- Do not log or persist user passwords.
- Use conventional commits without attribution trailers.
- Link the implementation PR to approved issue #222.

## Resolved test mode

- TDD mode: disabled (no explicit project/session TDD configuration found).
- Runner: repository Vitest scripts and release/version checks.

## Tasks

- [x] DAC-1: Make the cookie policy distinguish local desktop HTTP from HTTPS production and add focused regression tests.
- [x] DAC-2: Bump the patch release metadata/documentation and verify the desktop runtime flow.
- [ ] DAC-3: Commit the work unit, publish PR #222-linked, and merge only after all checks pass.

## Acceptance criteria

- A valid login over `http://localhost:3001` persists `ftth_session` and `/api/auth/me` returns the user.
- HTTPS production responses retain the `Secure` attribute.
- Focused tests, version checks, build checks, and CI pass.
- Release v0.2.2 is published only after green tag-triggered workflows.

## Progress and evidence

- Issue #222 created with `status:approved` and `type:chore`.
- Branch: `fix/desktop-auth-cookie`.
- `SESSION_COOKIE_SECURE` now overrides the production default; `false` is documented for local desktop HTTP.
- Version metadata and current release docs are aligned to `0.2.2`.
- Focused cookie/auth tests passed; release version check passed; Next.js production build passed.
- Runtime evidence: `GET /api/health` returned 200 with database connected; valid login returned 200 without `Secure`; login followed by `/api/auth/me` returned the user.
- Full DB unit command has 3 integration suites unavailable in the current environment because they expect `postgres:5432`; 41 non-integration tests passed and 15 integration cases were skipped before the suite failed on unavailable DB.
- Next: commit and publish PR #222-linked.

## Relevant files

- `packages/db/src/cookies.ts` — session cookie attributes.
- `packages/db/tests/` — focused database/auth tests.
- `apps/web/lib/auth/client.ts` — post-login session refresh.
- `apps/web/app/api/auth/login/route.ts` — login endpoint.
- `scripts/check-release-version.ts` — release metadata guard.
