# T1 — Harness compartido de fuzzing

**Feature**: `odd/tasks/fuzz-parsers.md`
**Specs**: S2, S3, S4, S8, S9
**Ruta**: worker

## Qué hacer

Crear el workspace privado y dev-only `packages/fuzz-harness`
(`@ftth-copilot/fuzz-harness`) con la definición autoritativa del contrato de
fuzzing:

- `fuzzEnv()` lee `FUZZ_SEED`, `FUZZ_PATH`, `FUZZ_RUNS` y `FUZZ_CORPUS` del entorno,
  con defaults deterministas.
- `fuzzParameters()` / `assertFuzz()` / `assertFuzzAsync()` envuelven `fc.assert` con
  esos parámetros y agregan al mensaje de fallo el comando literal de reproducción.
- `loadCorpus(dir)` lee el corpus semilla (`.txt` crudo y `.json` parseado) en orden
  determinista.
- `expectWithinDeadline(fn, budgetMs, label)` mide la duración de una llamada y falla
  si supera el presupuesto (guarda de ReDoS y de hang).
- `expectNoUnexpectedThrow(fn, isAllowed)` exige que toda excepción lanzada sea una de
  las permitidas por el parser (guarda anti-crash).
- `reproductionCommand(env)` devuelve el comando copiable para reproducir.

## Superficie de edición permitida

- `packages/fuzz-harness/**` (nuevo)
- `package.json` (raíz): scripts `test:fuzz` y `check:fuzz`
- `turbo.json`: tarea `test:fuzz`
- `packages/security/package.json`, `packages/monitoring/package.json`,
  `packages/connectors/smartolt/package.json`,
  `packages/connectors/mikrowisp/package.json`, `apps/web/package.json`:
  `devDependencies["@ftth-copilot/fuzz-harness"] = "workspace:*"`

## Fuera de superficie

No tocar `src/` de ningún paquete de producción. No tocar superficies protegidas.
No agregar dependencias de runtime. No commitear.

## Criterios de aceptación

- `pnpm install --prefer-offline` resuelve el workspace nuevo y actualiza el lockfile
  de forma mínima; después `pnpm install --frozen-lockfile --prefer-offline` pasa.
- `pnpm --filter @ftth-copilot/fuzz-harness typecheck` y `lint` pasan.
- El harness se importa desde los cinco workspaces consumidores sin error de tipos.
- El mensaje de fallo de una aserción fallida incluye el comando de reproducción.
