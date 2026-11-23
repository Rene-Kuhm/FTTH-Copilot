# Task: T2 — Línea base medida de `packages/evidence` y `packages/shared`

## Parent

`odd/tasks/mutation-testing.md`

## Status

pending

## Spec

S1, S2, S4

## What

Con el harness de T1 ya instalado, medir la línea base de los otros dos paquetes del alcance.

- `packages/evidence`: mutar `src/**/*.ts` salvo `src/index.ts` y `src/types.ts`.
- `packages/shared`: mutar `src/**/*.ts` salvo `src/index.ts`, `src/contracts.ts` y
  `src/design-system/**`.
- Registrar por paquete: total de mutantes, matados, sobrevivientes, sin cobertura, errores, score
  y tiempo de corrida.
- Si una corrida no termina en un tiempo razonable, achicar el scope de `mutate` de ese paquete,
  dejarlo escrito en `docs/testing-mutation.md` y reportar el recorte (no es un check verde).

## Route

writer (`gentle-ai-worker`)

## Deliverable

Score medido por paquete + lista de sobrevivientes relevantes (archivo:línea, tipo de mutación,
por qué importa) en `docs/testing-mutation.md`.
