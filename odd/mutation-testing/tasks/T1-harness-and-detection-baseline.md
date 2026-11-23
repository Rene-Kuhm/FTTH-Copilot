# Task: T1 — Harness StrykerJS + línea base medida de `packages/detection`

## Parent

`odd/tasks/mutation-testing.md`

## Status

pending

## Spec

S1, S2, S4, S5, S6, S7

## What

Instalar StrykerJS (runner Vitest) en los tres workspaces del alcance y dejar el target
documentado. En este task se mide la línea base de `packages/detection` (paquete puro y rápido).

- `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` en `^10.1.1`, **como devDependency de
  `packages/detection`, `packages/evidence` y `packages/shared`** (los únicos que las usan). La raíz
  no instala Stryker.
- Un `stryker.config.mjs` por paquete (ESM; `packages/shared` es `"type": "module"` y los otros dos
  no, así que `.mjs` es la extensión correcta en los tres).
- `test:mutation` en el `package.json` de cada paquete y en la raíz (`turbo run test:mutation`), más
  la task `test:mutation` en `turbo.json`.
- `pnpm-lock.yaml` con el cambio mínimo que impone `pnpm add -D --filter`.
- `.gitignore` para el `reports/mutation/` que Stryker escribe por defecto.
- `docs/testing-mutation.md` en español (convención de `docs/`): cómo correrlo, línea base por
  paquete, sobrevivientes relevantes, y el caveat de cobertura con Vitest 4.1.

Scope de mutación por paquete: `src/**/*.ts` excluyendo `src/index.ts` (barrel de re-exports) y
`src/types.ts` (sólo tipos). En `packages/shared` además `src/contracts.ts` y `src/design-system/**`
quedan fuera (declaraciones de esquemas y tokens: mutarlos no prueba comportamiento).

Configuración base de `stryker.config.mjs` (ajustar sólo lo que la evidencia obligue):

```js
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  mutate: ['src/**/*.ts', '!src/index.ts', '!src/types.ts'],
  reporters: ['clear-text', 'html', 'json-summary', 'progress'],
  coverageAnalysis: 'perTest',
  disableTypeCheck: true,
  thresholds: { high: 80, low: 60, break: null },
  concurrency: '50%',
  timeoutMS: 30000,
  testTimeoutMS: 15000,
  vitest: { configFile: 'vitest.config.ts' },
};
```

`disableTypeCheck: true` evita instalar `@stryker-mutator/typescript-checker`: la mutación valida
comportamiento, no tipos.

## Route

writer (`gentle-ai-worker`)

## Deliverable

`pnpm --filter @ftth-copilot/detection test:mutation` corre de verdad y produce score medido;
`pnpm test:mutation` encadena los tres paquetes; `docs/testing-mutation.md` documenta todo.
