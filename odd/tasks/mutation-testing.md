# Mutation testing (StrykerJS)

Feature: medir la calidad real de las pruebas de `packages/detection`, `packages/evidence` y
`packages/shared` con mutación de código (StrykerJS, runner Vitest), reportar el mutation score
por paquete, listar los mutantes sobrevivientes relevantes y cerrar los de bajo riesgo con tests
nuevos. Incremento 1: el gate no bloquea todavía; deja línea base medida y plan de ratchet.

Branch: `test/mutation-core`
Baseline: commit `4e8e073` ("docs(odd): registra el intento de review de T1 y el límite del proveedor")

## Specs

S1. "Mutation testing con StrykerJS (runner Vitest) acotado a packages/detection, packages/evidence y packages/shared primero"

S2. "reportá mutation score por paquete"

S3. "listá mutantes sobrevivientes relevantes y agregá tests que los maten donde sea de bajo riesgo"

S4. "Incremental, con thresholds iniciales realistas."

S5. "Si necesitás una dependencia de dev, agregala solo al workspace que la usa y justificá."

S6. "Instalá con 'pnpm install --frozen-lockfile --prefer-offline' (si hay que cambiar el lockfile, hacelo mínimo)."

S7. "Entregá: pruebas que corran de verdad y pasen (o un fallo real reportado con causa exacta, sin ocultarlo), un script/target documentado para correrlas, y docs breves en el mismo commit."

S8. "Reglas: solo fixtures sintéticos (IPs de documentación, tenants inventados), nada de datos reales ni secretos; no agregues escrituras activas sobre la red; no edites superficies protegidas (packages/db/prisma/migrations, packages/db/src/generated, research/olt, docs/compatibility-matrix.md, packages/eval, golden snapshots, openspec/changes/archive, LICENSE). Todo tenant-aware."

S9. "Commit(s) atómicos con Conventional Commits, SIN Co-Authored-By ni atribución de IA, SIN push."

S10. "Al final escribí REPORT.md en la raíz del worktree (sin commitear) con: qué se agregó, comandos para correrlo, resultados medidos reales, hallazgos/bugs encontrados, y qué quedó sin hacer."

S11. "No declares verde un check que no corrió."

## Tasks

| ID | Task | Specs | Route | Commit | Risk |
|----|------|-------|-------|--------|------|
| T1 | Harness StrykerJS + línea base medida de `packages/detection` | S1, S2, S4, S5, S6, S7 | writer (`gentle-ai-worker`) | `325585e` `build(tools): add StrykerJS mutation testing for detection, evidence and shared` | Risk: item 5 (dependencias de dev nuevas en tres workspaces + `pnpm-lock.yaml`) |
| T2 | Línea base medida de `packages/evidence` y `packages/shared` | S1, S2, S4 | writer (`gentle-ai-worker`) | mismo commit que T1 (mismo archivo de tooling) | Risk: item 5 (misma unidad de tooling que T1) |
| T3 | Tests que maten los sobrevivientes relevantes de `packages/detection` | S3 | writer (`gentle-ai-worker`) | `test(detection): cover surviving mutants in the signal detectors` | Risk: none |
| T4 | Tests que maten los sobrevivientes relevantes de `packages/evidence` | S3 | writer (`gentle-ai-worker`) | `test(evidence): cover surviving mutants in the truth gate` | Risk: none |
| T5 | Tests que maten los sobrevivientes relevantes de `packages/shared` | S3 | writer (`gentle-ai-worker`) | `test(shared): cover surviving mutants in redaction and learning` | Risk: none |
| T7 | `docs/testing-mutation.md` con los scores post T3-T5 y el ratchet | S2, S4 | writer (`gentle-ai-worker`) | `docs(testing): refresh the mutation baselines after closing survivors` | Risk: none |
| T6 | `REPORT.md` sin commitear | S10, S11 | writer (`gentle-ai-worker`) | ninguno (queda untracked) | Risk: none |

## Log

L1. Contexto: monorepo FTTH-Copilot (pnpm 11 + Turborepo, TS estricto, Vitest, Playwright, Next.js 16). Leé AGENTS.md y ARCHITECTURE.md primero. Trabajás en TU propio git worktree (cwd actual, rama propia); no toques el árbol principal ni otras ramas. Reglas: solo fixtures sintéticos (IPs de documentación, tenants inventados), nada de datos reales ni secretos; no agregues escrituras activas sobre la red; no edites superficies protegidas (packages/db/prisma/migrations, packages/db/src/generated, research/olt, docs/compatibility-matrix.md, packages/eval, golden snapshots, openspec/changes/archive, LICENSE). Todo tenant-aware. Si necesitás una dependencia de dev, agregala solo al workspace que la usa y justificá. Instalá con 'pnpm install --frozen-lockfile --prefer-offline' (si hay que cambiar el lockfile, hacelo mínimo). Entregá: pruebas que corran de verdad y pasen (o un fallo real reportado con causa exacta, sin ocultarlo), un script/target documentado para correrlas, y docs breves en el mismo commit. Commit(s) atómicos con Conventional Commits, SIN Co-Authored-By ni atribución de IA, SIN push. Al final escribí REPORT.md en la raíz del worktree (sin commitear) con: qué se agregó, comandos para correrlo, resultados medidos reales, hallazgos/bugs encontrados, y qué quedó sin hacer. No declares verde un check que no corrió. Tu tarea: 26 Mutation testing con StrykerJS (runner Vitest) acotado a packages/detection, packages/evidence y packages/shared primero; reportá mutation score por paquete, listá mutantes sobrevivientes relevantes y agregá tests que los maten donde sea de bajo riesgo. Incremental, con thresholds iniciales realistas.

L2. Decisión del orquestador (2026-11): StrykerJS `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` `^10.1.1` (la línea 10.x es la que soporta Vitest 4.1 y exige Node 22+, que el repo ya exige). La dependencia se declara **solo** en los tres workspaces que la usan (`packages/detection`, `packages/evidence`, `packages/shared`); la raíz no la instala, sólo encadena el target por Turbo.

L3. Decisión del orquestador (2026-11): `coverageAnalysis: "perTest"` es el default pero Stryker tiene un bug conocido de cobertura mal emparejada con Vitest 4.1.x (falsos sobrevivientes y falsos "No coverage"): <https://github.com/stryker-mutator/stryker-js/issues/5928>. Por eso T1 corre `packages/detection` dos veces (`perTest` y `coverageAnalysis: "off"`) y reporta ambos números: si difieren, el score de la línea base hay que leerlo con ese caveat.

L4. Decisión del orquestador (2026-11): el primer incremento **no bloquea**: `thresholds.break = null` en los tres paquetes, con `high`/`low` derivados de la línea base medida. El ratchet a un `break` real queda documentado en `docs/testing-mutation.md` y es trabajo del incremento 2.
