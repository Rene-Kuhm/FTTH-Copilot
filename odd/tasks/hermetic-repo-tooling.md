# Hermetic repo tooling: mise + living docs + agent-first context

Objective: give the repo one hermetic, reproducible dev environment (mise) whose tasks are the
same ones CI runs, verify the docs against the real code (zero-drift), and give every module a
short agent-first `AGENTS.md`.
Branch: `swarm/issue-308-feat-repo-entorno-hermetico-con-` (from `main` @ 3cbbbe0a).
Delivery: three reviewable work-unit commits. Test runner: Vitest (`pnpm test`) + `mise run docs-test`.

## Specs

- **S1** — Entorno hermético: `mise.toml` con versiones exactas y `mise.lock` commiteado; tareas
  `mise run build`, `test`, `lint`, `docs-test` y `repo-map`; el CI instala con el mismo mise
  (`jdx/mise-action`) y corre esas mismas tareas.
  - Check: `mise.lock` existe en git; `mise install --locked` no falla; `mise tasks` lista
    `build`, `test`, `lint`, `docs-test`, `repo-map`; `.github/workflows/ci.yml` usa
    `jdx/mise-action` e invoca `mise run <task>`.
- **S2** — Documentación viva (zero-drift): todo bloque de código ejecutable de `README.md` y
  `docs/` se ejecuta en CI con `mise run docs-test`; un ejemplo roto no se mergea.
  - Check: `mise run docs-test` corre sobre `README.md` + `docs/**/*.md` y falla (exit != 0)
    ante un ejemplo roto (script inexistente, import inexistente, JSON inválido, sintaxis bash
    inválida).
- **S3** — Contexto agent-first: un `AGENTS.md` corto en cada módulo principal con sus propias
  reglas (qué invariantes cuida, cómo se prueba, qué no tocar); `mise run repo-map` imprime el
  esqueleto del repo (módulos, símbolos exportados con sus firmas y tipos, dependencias entre
  módulos, sin implementación) en menos de ~8.000 tokens.
  - Check: existe `AGENTS.md` en cada módulo principal; `mise run repo-map` imprime menos de
    ~8.000 tokens y lista símbolos con firma y tipo.

- **S4** (assumption) — Los bloques de documentación que necesitan servicios externos (Docker,
  Postgres, un servidor en ejecución) no se ejecutan literalmente en CI: se **validan** contra el
  estado real del repo (existencia de scripts de `package.json`, de archivos de `scripts/`, de
  tareas de `turbo.json`/`mise.toml`, exports de los paquetes del workspace, sintaxis). Los bloques
  marcados como ejecutables en un entorno hermético sí se ejecutan de verdad. Esto se documenta en
  `docs/engineering/living-docs.md`.
  - Check: la política está escrita en `docs/engineering/living-docs.md` y el runner distingue
    "validado" de "ejecutado" en su salida.

## Tasks

- **ENV-1 — `mise.toml` con versiones exactas y tareas** — S1 — inline — done
- **ENV-2 — `mise.lock` commiteado** — S1 — inline — done
- **ENV-3 — CI con `jdx/mise-action` corriendo las tareas de mise** — S1 — inline — done
- **DOC-1 — `scripts/docs-test.ts`: extracción y validación de bloques** — S2, S4 — inline — done
- **DOC-2 — `docs-test` en `mise` + CI + política documentada** — S2, S4 — inline — done
- **MAP-1 — `scripts/repo-map.ts`: esqueleto del repo bajo el presupuesto de tokens** — S3 — inline — done
- **CTX-1 — `AGENTS.md` por módulo** — S3 — inline — done

## Log

- **L1** — "Issue 308: feat(repo): entorno hermético con mise, docs vivas y contexto agent-first

Dar al repo un entorno de desarrollo hermético y reproducible con mise, de modo que las mismas
versiones y tareas corran en local y en CI, verificar la documentación contra el código real
(zero-drift) y dotar de contexto agent-first a cada módulo. Depende de que exista la
documentación y del CI base para enganchar los jobs.

- [x] Entorno hermético: `mise.toml` con versiones exactas y `mise.lock` commiteado; tareas
  `mise run build`, `test`, `lint`, `docs-test` y `repo-map`; el CI instala con el mismo mise
  (`jdx/mise-action`) y corre esas mismas tareas
  → `mise.toml` + `mise.lock` commiteados; 14 tareas declaradas; el CI usa `jdx/mise-action`
  (11 usos) y corre `lint`, `typecheck`, `docs-test`, `repo-map`, `contract:check`,
  `test-scripts`, `c4:check`, `test:coverage-check` y `build`.
- [x] Documentación viva (zero-drift): todo bloque de código ejecutable de `README.md` y `docs/`
  se ejecuta en CI con `mise run docs-test`; un ejemplo roto no se mergea
  → job `Docs (zero-drift) & repo map` en CI. Local: 361 bloques en 104 archivos, 0 errores.
- [x] Contexto agent-first: un `AGENTS.md` corto en cada módulo principal con sus propias reglas
  (qué invariantes cuida, cómo se prueba, qué no tocar); `mise run repo-map` imprime el esqueleto
  del repo (módulos, símbolos exportados con sus firmas y tipos, dependencias entre módulos, sin
  implementación) en menos de ~8.000 tokens
  → 18 `AGENTS.md` versionados (12 paquetes, `apps/web`, 4 conectores, `services/laya`);
  `repo-map` imprime ~2.186 palabras.

Owns: mise.toml, mise.lock, scripts/, apps/**/AGENTS.md, packages/**/AGENTS.md,
services/**/AGENTS.md, .github/workflows/

Depende de: #306, #307
Parte de: #304"

- **L2** (2026-10-26) — El Technical Fellow pidió dividir la issue en 3 features independientes
  porque el diff anterior estaba vacío y la tarea agrupaba 3 features grandes. La tarea se rehizo
  manteniendo las tres unidades como work-unit commits independientes (ENV, DOC, CTX) sobre la misma
  rama, para que cada una se pueda revisar y mergear por separado.
- **L3** (2026-10-26) — Decisiones de implementación:
  - `node = "22.23.4"` y `pnpm = "11.22.0"`: versiones exactas que coinciden con `.nvmrc` (`22`)
    y con `packageManager` del `package.json`. `mise.lock` fija URL y checksum por plataforma.
  - Python no entra al toolchain de mise: `services/laya` fija su intérprete en el `Dockerfile` y
    su implementación de referencia es TypeScript, en `packages/shared`.
  - El CI deja de usar `pnpm/action-setup` + `actions/setup-node`: instala con `jdx/mise-action`
    y `install_args: --locked`, de modo que un `mise.lock` desactualizado rompe el pipeline.
    Se conserva el cache del store de pnpm (`actions/cache` sobre `.pnpm-store`) para no perder
    los minutos de instalación.
  - `docs-test` tiene dos capas (validar contra el repo / ejecutar de verdad). La ejecución real
    aplica a los bloques marcados con el atributo `exec` y a los que solo piden versiones
    (`node --version`, `pnpm --version`): el resto necesita Docker, Postgres o un servidor ya
    levantado, y en CI se valida en lugar de ejecutarse. La política queda escrita en
    `docs/engineering/living-docs.md`.
  - `scripts/` no es un workspace de pnpm: para que su código tenga el mismo control de calidad
    que el resto, `mise run lint` y `mise run typecheck` agregan
    `eslint --config scripts/eslint.config.mjs scripts` y `tsc --noEmit -p scripts/tsconfig.json`.
    El tsconfig de `scripts/` cubre solo el tooling nuevo: los scripts previos importan código de
    los workspaces y sus errores son de otros módulos.
- **L4** (2026-10-26) — Frontera de slice y estrategia de entrega. El issue pide tres entregables
  (entorno hermético, docs vivas, contexto agent-first) que no se pueden reviewar bien en un solo
  commit. La entrega son **commits atómicos y revisables por separado**, todos en la misma rama
  (el entregable del issue es único y el harness abre un solo PR):
  1. `build(repo): entorno hermético con mise` — `mise.toml`, `mise.lock` y el CI con
     `jdx/mise-action`. Cierra el primer slice.
  2. La herramienta de docs-test, en tres commits: extracción y parsing → verificaciones contra el
     repo → comando, política documentada y job del CI.
  3. `feat(repo): repo-map` — el esqueleto del repo.
  4. El contexto agent-first, por capa de módulos.
- **L5** (2026-10-26) — Verificación del entorno: `mise run lint` (0 errores),
  `mise run typecheck` (0 errores), `mise run test` (17 workspaces, 735 tests) y
  `mise run docs-test` (349 bloques, 0 errores, 14 avisos) en verde. La corrida de tests con
  concurrencia default (10) hace flakear `packages/db` por timeout de bcrypt en este sandbox de
  4 cores; con `--concurrency=2` pasa entero. No es un efecto del cambio: el test aislado del
  paquete pasa en 3,5 s.
- **L6** (2026-10-26) — Evidencia final de la rama:
  - `mise run lint` → 17 workspaces + `scripts/`, 0 errores (5 avisos, todos en scripts previos).
  - `mise run typecheck` → 17 workspaces + `tsc -p scripts/tsconfig.json`, 0 errores.
  - `mise run test` → 17 workspaces en verde (con `--concurrency=2`; ver L5).
  - `mise run docs-test` → 349 bloques en 100 archivos, 261 verificados, 3 ejecutados, 0 errores,
    14 avisos (variables de servicios externos y scripts que viven en un paquete del workspace).
  - `mise run repo-map` → 7704 tokens de un presupuesto de 8000, 17 módulos, 865 símbolos.
  - RED del runner: con un ejemplo roto (script inexistente, tarea de turbo inexistente, tarea de
    mise inexistente, export inexistente, JSON y YAML inválidos) `mise run docs-test` falla con
    exit 1 y señala archivo y línea.
  - `mise lock --dry-run --json` → `[]`: el lockfile está sincronizado con `mise.toml`.
- **L7** (2026-10-26) — El CI del PR marqueó con CodeQL (`js/insecure-temporary-file`, severidad alta)
  los tres `writeFileSync` de `scripts/docs-test.ts`: escribían el bloque en `os.tmpdir()` con un
  nombre predecible (CWE-377). Corrección: no se escribe ningún archivo en el temporal. `bash -n`
  y el intérprete de Python leen el bloque por stdin, y los bloques que se ejecutan de verdad
  corren por stdin dentro de un directorio creado con `mkdtemp` (único, permisos 0700). El RED del
  runner sigue detectando bash inválido, python que no compila, script inexistente y export
  inexistente.
