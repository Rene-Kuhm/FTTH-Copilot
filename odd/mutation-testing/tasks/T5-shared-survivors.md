# Task: T5 — Tests que maten los sobrevivientes de `packages/shared`

## Parent

`odd/tasks/mutation-testing.md`

## Status

pending

## Spec

S3

## What

Agregar tests en `packages/shared/tests/` que maten los mutantes sobrevivientes de bajo riesgo de
`packages/shared` (redacción de secretos, learning, inyección, logger).

Un test nuevo debe fallar con el mutante aplicado y pasar sin él; asertar el efecto observable y
usar sólo fixtures sintéticos (sin secretos reales: los valores de prueba son ficticios). Los
sobrevivientes en `laya-*` que dependan de un servicio externo quedan como follow-up documentado.

## Route

writer (`gentle-ai-worker`)

## Deliverable

`packages/shared/tests/**` con los tests nuevos + score de `packages/shared` post-cambio.
