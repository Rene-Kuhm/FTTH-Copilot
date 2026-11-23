# Task: T4 — Tests que maten los sobrevivientes de `packages/evidence`

## Parent

`odd/tasks/mutation-testing.md`

## Status

pending

## Spec

S3

## What

Agregar tests en `packages/evidence/tests/` que maten los mutantes sobrevivientes de bajo riesgo de
`packages/evidence` (TruthGate, abstention policy, calidad de evidencia, topología).

Un test nuevo debe fallar con el mutante aplicado y pasar sin él; asertar el efecto observable
(veredicto de la regla, motivo de abstención, umbral) y usar sólo fixtures sintéticos con tenants
inventados. Los sobrevivientes que exijan cambiar el contrato público de `packages/evidence`
quedan como follow-up documentado.

## Route

writer (`gentle-ai-worker`)

## Deliverable

`packages/evidence/tests/**` con los tests nuevos + score de `packages/evidence` post-cambio.
