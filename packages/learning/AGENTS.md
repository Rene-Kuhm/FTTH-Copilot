# AGENTS.md — `@ftth-copilot/learning`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Fase 0 del learning loop (`odd/tasks/learning-loop.md`). El núcleo **puro** del
aprendizaje: resolución de etiquetas, agrupación de incidentes en eventos, split temporal
train/eval y cálculo de suficiencia de muestra.

Todavía **no cambia nada de lo que ve el usuario**. Es la verdad de base: las capas L1
(recall denso), L2 (baselines de umbral) y L3 (reranking) se apoyan en estas funciones, y
nada se publica hasta que exista el gate de release con su eval.

## Qué invariantes cuida

- **Puro por construcción.** Sin Prisma, sin Redis, sin red y sin reloj implícito: el tiempo
  entra siempre como parámetro. La persistencia es del worker; la web solo lee artefactos ya
  publicados. Un test (`tests/package-shape.test.ts`) falla si alguien le mete una
  dependencia de la base de datos.
- **La pared del Truth Gate (I1).** Ningún artefacto aprendido entra al Truth Gate ni a la
  política de abstención. `tests/import-graph.test.ts` lee el código de `packages/evidence` y
  falla si algo de ahí alcanza a este paquete.
- **Determinismo (I8).** Mismo input ⇒ mismo output, byte a byte. Los ids de evento y los
  hashes se derivan del contenido, nunca del reloj ni del orden de arrival.
- **Insuficiencia honesta (I10).** Bajo la muestra mínima, la métrica no se publica: se
  declara `insuficiente`. Nunca un número inventado.
- **Sin fuga entre train y eval (D9).** El split es temporal y por evento; nunca aleatorio.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/learning test
pnpm --filter @ftth-copilot/learning test:coverage
```

`tests/` cubre la forma del paquete, la pared de imports, la resolución de etiquetas, la
agrupación en eventos y el split temporal.

## Qué no tocar

- El contrato canónico de etiquetas (`FEEDBACK_LABELS`) y el umbral de muestra
  (`DEFAULT_MIN_SAMPLE_SIZE`): viven en `packages/shared/src/learning.ts` y acá se importan,
  no se redefinen.
- La fase 1 del tablero (`TenantPolicy.learningMode`, retracciones): requiere revisión
  explícita antes de aterrizar.
- Cualquier import desde `packages/evidence` hacia acá: rompe I1.

## Superficie pública

`src/index.ts` exporta los contratos de datos (`src/types.ts`) y las funciones de cada fase.
El esqueleto completo lo imprime `mise run repo-map`.
