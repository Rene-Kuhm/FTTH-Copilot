# Task: T3 — Tests que maten los sobrevivientes de `packages/detection`

## Parent

`odd/tasks/mutation-testing.md`

## Status

pending

## Spec

S3

## What

Con la línea base de T1 a la vista, agregar tests en `packages/detection/tests/` que maten los
mutantes sobrevivientes de bajo riesgo. Un test nuevo debe:

- fallar con el mutante aplicado (RED) y pasar sin él (GREEN);
- asertar el efecto observable de la regla (valor de salida, umbral, clasificación), no el detalle
  interno;
- usar sólo fixtures sintéticos (series sintéticas de potencia/temperatura, tenants inventados).

Sobrevivientes de alto riesgo o que exijan tocar código de producción quedan listados como
follow-up, no se "matan" reescribiendo el detector.

## Route

writer (`gentle-ai-worker`)

## Deliverable

`packages/detection/tests/**` con los tests nuevos + score de `packages/detection` post-cambio.
