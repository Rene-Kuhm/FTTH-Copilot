# T6 — Docs de fuzzing y `REPORT.md`

**Feature**: `odd/tasks/fuzz-parsers.md`
**Specs**: S10, S11, S12
**Ruta**: worker (docs) + coordinator (REPORT.md)

## Qué hacer

- `docs/fuzzing.md`: qué se fuzzea, cómo correrlo (`pnpm test:fuzz`, `pnpm check:fuzz`),
  cómo reproducir un caso (`FUZZ_SEED`, `FUZZ_PATH`, `FUZZ_RUNS`, `FUZZ_CORPUS`), qué
  es el corpus semilla y cómo se agrega un caso, y qué significa cada guarda
  (crash, hang, ReDoS, fuga).
- Un enlace breve desde la documentación de testing existente
  (`docs/testing-without-hardware.md` o el índice de `docs/`) hacia `docs/fuzzing.md`.
- `REPORT.md` en la raíz del worktree, **sin commitear**, con: qué se agregó, comandos
  para correrlo, resultados medidos reales (con los números que salieron de la
  corrida), hallazgos/bugs encontrados y qué quedó sin hacer.

Las docs siguen el idioma del documento que extienden: `docs/` es mayormente en
español.

## Superficie de edición permitida

- `docs/**`

## Fuera de superficie

No tocar `README.md` ni `AGENTS.md` sin necesidad (el bloque gestionado por `turbo` en
`AGENTS.md` no se edita a mano). `REPORT.md` no se commitea. No commitear.

## Criterios de aceptación

- `docs/fuzzing.md` existe y los comandos que documenta se ejecutan tal cual.
- `REPORT.md` está en la raíz del worktree y no aparece en `git status` como staged.
