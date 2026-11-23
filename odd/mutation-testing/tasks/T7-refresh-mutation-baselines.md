# Task: T7 — Actualizar `docs/testing-mutation.md` con los scores post T3-T5

## Parent

`odd/tasks/mutation-testing.md`

## Status

pending

## Spec

S2, S4

## What

Un único writer actualiza la documentación después de que T3, T4 y T5 hayan cerrado los
sobrevivientes de bajo riesgo. Editar el mismo archivo desde tres writers en paralelo genera
conflictos, por eso este task existe.

- Línea base medida antes y después por paquete (score, mutantes totales, matados, sobrevivientes,
  timeout, sin cobertura, errores), con los números observados, nunca estimados.
- Los sobrevivientes que siguen vivos después de T3-T5, con el motivo por el que no se mataron
  (mutante de alto riesgo, oTests que exigirían tocar `src/**`).
- El plan de ratchet del incremento 2: el piso medido por paquete y el `thresholds.break` que se
  debe activar en el siguiente incremento.

## Route

writer (`gentle-ai-worker`)

## Deliverable

`docs/testing-mutation.md` actualizado con los números reales del estado final.
