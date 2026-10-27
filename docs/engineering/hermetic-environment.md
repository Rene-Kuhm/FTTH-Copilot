# Entorno hermético con mise

El repo declara sus herramientas en [`mise.toml`](../../mise.toml) y su resolución exacta en
[`mise.lock`](../../mise.lock). Local y CI instalan lo mismo, con los mismos checksums.

```bash exec
node --version
```

## Qué declara el repo

| Herramienta | Versión | Por qué |
|---|---|---|
| `node` | `22.23.4` | La versión LTS que declara `.nvmrc` (`22`), fijada al parche exacto. |
| `pnpm` | `11.22.0` | La misma que declara `packageManager` en `package.json`. |

El servicio `services/laya` (Python) no entra en este toolchain: su intérprete queda fijado por la
imagen de su `Dockerfile`, y la implementación de referencia vive en TypeScript, en
`packages/shared`.

## Tareas

Las tareas de mise son la **única** forma de correr el repo, en local y en CI:

| Tarea | Qué corre |
|---|---|
| `mise run deps` | `pnpm install --frozen-lockfile` |
| `mise run build` | `turbo run build` sobre los 16 workspaces |
| `mise run lint` | ESLint sobre los 16 workspaces |
| `mise run typecheck` | `tsc --noEmit` estricto por workspace |
| `mise run test` | Suite unitaria (Vitest) + tests de `scripts/` |
| `mise run docs-test` | Verificación zero-drift de `README.md` y `docs/` |
| `mise run repo-map` | Esqueleto del repo: módulos, símbolos y dependencias |

## El lockfile

`mise.lock` fija la versión **y** la URL de descarga y el checksum de cada herramienta, para cada
plataforma. Es la parte que hace el entorno reproducible: sin él, `mise install` resolvería
`node = "22.23.4"` a un artefacto distinto si el mirror cambiara.

```bash
mise install --locked
```

Falla si el lockfile no cubre lo que `mise.toml` pide. Ese es el chequeo que corre el CI.

Para actualizar una versión:

```bash
mise lock --bump
```

Y después se commitea `mise.lock` en el mismo commit que el cambio de `mise.toml`.

## El CI

Cada job del workflow [`ci.yml`](../../.github/workflows/ci.yml) instala con la misma action:

```yaml
- uses: jdx/mise-action@v2
  with:
    version: 2026.10.12
    install_args: --locked
```

`install_args: --locked` hace que la instalación falle si `mise.lock` no está sincronizado con
`mise.toml`: el CI no puede instalar una versión distinta de la que el repo declara.

Después del setup, los jobs corren tareas de mise (`mise run lint`, `mise run test`,
`mise run build`, `mise run docs-test`), no comandos sueltos. Si la tarea cambia, el CI y el
entorno local cambian juntos.

## Por qué mise y no solo `.nvmrc`

`.nvmrc` dice "Node 22" y `package.json` dice "pnpm 11.22.0", pero nada obliga al CI a usarlos, ni
impide que un patch de Node cambie el comportamiento entre dos corridas. `mise.toml` + `mise.lock`
convierten esa intención en una instalación verificable: mismo binario, mismo checksum, en la
máquina del developer y en el runner.
