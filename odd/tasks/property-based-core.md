# Feature: Property-based testing for core package invariants

Status: in progress — 2026-09-23 · Project: FTTH-Copilot · Worktree: /home/tecnodespegue/proyectos/.worktrees-ftth-tests/property-based-core (branch test/property-based-core)

## Specs

### S1 — Core surface
> 24 Property-based testing con fast-check sobre invariantes de paquetes núcleo: detection (detectores puros), correlación de incidentes/evidence, shared (schemas Zod round-trip), aislamiento por tenantId.

### S2 — Explicit invariants and reproducible seeds
> Declará cada invariante explícitamente y usá seeds reproducibles.

### S3 — Deliverables
> Entregá: pruebas que corran de verdad y pasen (o un fallo real reportado con causa exacta, sin ocultarlo), un script/target documentado para correrlas, y docs breves en el mismo commit.

### S4 — Commits
> Commit(s) atómicos con Conventional Commits, SIN Co-Authored-By ni atribución de IA, SIN push.

### S5 — Report
> Al final escribí REPORT.md en la raíz del worktree (sin commitear) con: qué se agregó, comandos para correrlo, resultados medidos reales, hallazgos/bugs encontrados, y qué quedó sin hacer.

### S6 — Data and isolation rules
> Reglas: solo fixtures sintéticos (IPs de documentación, tenants inventados), nada de datos reales ni secretos; no agregues escrituras activas sobre la red; no edites superficies protegidas (packages/db/prisma/migrations, packages/db/src/generated, research/olt, docs/compatibility-matrix.md, packages/eval, golden snapshots, openspec/changes/archive, LICENSE). Todo tenant-aware.

### S7 — Dependency and install
> Si necesitás una dependencia de dev, agregala solo al workspace que la usa y justificá. Instalá con 'pnpm install --frozen-lockfile --prefer-offline' (si hay que cambiar el lockfile, hacelo mínimo).

### S8 — Honesty about checks
> No declares verde un check que no corrió.

## Tasks

- T1 — Fast-check as dev dependency in the four workspaces that use it; lockfile refreshed minimally. (S1, S7) — route: writer (manifests + lockfile) / parent (install) — commit: `chore(test): add fast-check to core workspaces`
- T2 — Detection pure-detector property suite. (S1, S2) — route: writer — commit: `test(detection): property-based invariants for pure detectors`
- T3 — Shared canonical-contract Zod round-trip property suite. (S1, S2) — route: writer — commit: `test(shared): property-based round-trip invariants for canonical contracts`
- T4 — Evidence incident-correlation property suite. (S1, S2) — route: writer — commit: `test(evidence): property-based invariants for incident correlation`
- T5 — Alerts tenant-isolation property suite. (S1, S2) — route: writer — commit: `test(alerts): property-based tenant isolation invariants`
- T6 — Documented runnable target (`test:property`) and brief property-based-testing doc. (S3) — route: writer — commit: `test: add test:property target and property-based testing guide`

## Applicable checks

- `pnpm install --frozen-lockfile --prefer-offline`
- `pnpm --filter @ftth-copilot/detection --filter @ftth-copilot/shared --filter @ftth-copilot/evidence --filter @ftth-copilot/alerts test`
- `pnpm --filter @ftth-copilot/detection --filter @ftth-copilot/shared --filter @ftth-copilot/evidence --filter @ftth-copilot/alerts typecheck`
- `pnpm --filter @ftth-copilot/detection --filter @ftth-copilot/shared --filter @ftth-copilot/evidence --filter @ftth-copilot/alerts lint`
- `pnpm test:property` (added by T6)

## Log

### L1 — 2026-09-23 — user request (verbatim)
> Contexto: monorepo FTTH-Copilot (pnpm 11 + Turborepo, TS estricto, Vitest, Playwright, Next.js 16). Leé AGENTS.md y ARCHITECTURE.md primero. Trabajás en TU propio git worktree (cwd actual, rama propia); no toques el árbol principal ni otras ramas. Reglas: solo fixtures sintéticos (IPs de documentación, tenants inventados), nada de datos reales ni secretos; no agregues escrituras activas sobre la red; no edites superficies protegidas (packages/db/prisma/migrations, packages/db/src/generated, research/olt, docs/compatibility-matrix.md, packages/eval, golden snapshots, openspec/changes/archive, LICENSE). Todo tenant-aware. Si necesitás una dependencia de dev, agregala solo al workspace que la usa y justificá. Instalá con 'pnpm install --frozen-lockfile --prefer-offline' (si hay que cambiar el lockfile, hacelo mínimo). Entregá: pruebas que corran de verdad y pasen (o un fallo real reportado con causa exacta, sin ocultarlo), un script/target documentado para correrlas, y docs breves en el mismo commit. Commit(s) atómicos con Conventional Commits, SIN Co-Authored-By ni atribución de IA, SIN push. Al final escribí REPORT.md en la raíz del worktree (sin commitear) con: qué se agregó, comandos para correrlo, resultados medidos reales, hallazgos/bugs encontrados, y qué quedó sin hacer. No declares verde un check que no corrió. Tu tarea: 24 Property-based testing con fast-check sobre invariantes de paquetes núcleo: detection (detectores puros), correlación de incidentes/evidence, shared (schemas Zod round-trip), aislamiento por tenantId. Declará cada invariante explícitamente y usá seeds reproducibles.

### L2 — 2026-09-23 — exploration evidence
- API map of detection/evidence/shared/alerts produced by `gentle-ai-explore`; see `odd/property-based-core/tasks/` for the per-task invariants.
- `fast-check` already resolves to `4.10.2` in `pnpm-lock.yaml` as a devDependency of `@ftth-copilot/monitoring`; reusing the same range `^4.9.0` keeps the lockfile change to importer entries only.
- Precedent for the import style: `packages/monitoring/tests/conformance/property-asn1.test.ts` (`import fc from 'fast-check'`, `fc.assert(..., { numRuns: 200 })`).
- Vitest `4.1.12` in all four target workspaces; each has `tests/**/*.test.ts` as include pattern and `globals: false`.

### L3 — 2026-09-23 — decisions
- Delivery shape: `feature-branch-chain` (no push, no PR) — the session cannot ask the human a delivery-risk question.
- Risk classification for T1: item 5 (dev dependency added to four workspaces) — the independent verifier is required for that unit.
- Risk classification for T2-T5: none expected — test-only additions; if a writer finds a real defect it must report it instead of silently encoding the buggy behavior.
- Tenant isolation is asserted as a first-class property in T4 and T5 (not only as fixture hygiene), because the correlation layer is where tenant mixing would be observable.
