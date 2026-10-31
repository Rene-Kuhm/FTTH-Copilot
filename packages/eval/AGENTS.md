# AGENTS.md — `@ftth-copilot/eval`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L4. El arnés de evaluación: corpus adversarial con tenants piloto, métricas de precisión y
recall, el gate de attack-pass-rate y el backfill del `verdict_log`.

## Qué invariantes cuida

- **El gate es 100% o no es gate.** Relajar una aserción equivale a borrar el control: es una
  decisión de diseño, no un ajuste de CI.
- **El corpus se commitea.** Los casos son datos del repo, con su esquema
  (`ftth.eval-corpus.v1`), no archivos efímeros.
- **El arnés no llama al LLM.** El seam está mockeado: el CI corre sin claves de proveedor.
- **La cobertura es explícita**: las 7 superficies de entrada no confiable y los 7 tipos de
  inyección tienen que estar cubiertas.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/eval run test
```

Es el job `eval` del CI, y corre aunque el resto falle (`if: always()`).

## Qué no tocar

- `src/assertions.ts` sin una decisión explícita: son las aserciones del gate.
- `corpus/` sin actualizar su esquema y el runner: el CI valida el corpus entero.

## Superficie pública

`src/index.ts` exporta el runner, las aserciones del gate, las métricas y los exportadores de
feedback. El esqueleto completo lo imprime `mise run repo-map`.
