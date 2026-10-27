# Feature: Contrato y C4 como fuente única (Issue 310)

Cerrar el estándar de documentación del repo: la API y la arquitectura dejan de
tener dos fuentes de verdad cada una. Un contrato genera la referencia, los
tipos y las validaciones; un modelo C4 genera las vistas. El CI falla si lo
generado no está al día.

## Specs

- **S1** — "la API se define en un contrato (OpenAPI/TypeSpec, Protobuf con buf o JSON Schema)"
  → La API HTTP se define en un contrato OpenAPI 3.1 en `docs/contract/openapi.yaml`.
  El contrato cubre todos los endpoints de `apps/web/app/api/**`: un test de paridad
  falla si un método/ruta del código no está en el contrato.

- **S2** — "la referencia de `docs/reference/`, los tipos o SDKs y las validaciones se generan de ahí"
  → `docs/reference/api-http.md` se genera desde el contrato. `packages/api-contract`
  expone los tipos TypeScript y los esquemas Zod generados desde el mismo contrato.

- **S3** — "y el CI falla si lo generado no está al día"
  → Un job de CI regenera los artefactos y falla con `git diff --exit-code` si
  difieren de lo commiteado.

- **S4** — "un único modelo (Structurizr DSL o D2) del que salen las vistas de Contexto, Contenedores y Componentes"
  → Un solo archivo `docs/architecture/c4/model.d2` con los tableros `context`,
  `container` y `component`.

- **S5** — "renderizadas en CI"
  → Un job de CI renderiza las vistas SVG y falla si lo commiteado difiere.

- **S6** — "reemplaza los Mermaid de arquitectura"
  → Los diagramas Mermaid de arquitectura (`README.md`, `ARCHITECTURE.md`,
  `AGENTS.md`) pasan a ser las vistas C4 renderizadas.

- **S7** — "Los tests y el build del repo pasan"
  → `mise run lint`, `mise run typecheck`, `mise run test` y `mise run build` en verde.

## Tasks

| ID | Spec | Ruta | Entrega | Commit |
|---|---|---|---|---|
| T1 | S1 | `scripts/extract-api-routes.ts` | Inventario de rutas extraído del código | — |
| T2 | S1,S2 | `docs/contract/openapi.yaml` | Contrato OpenAPI 3.1 completo | — |
| T3 | S2,S3 | `scripts/lib/api-contract.ts`, `scripts/generate-api-contract.ts` | Generador (tipos, Zod, referencia) | — |
| T4 | S2 | `packages/api-contract/**` | Paquete con tipos y validadores generados | — |
| T5 | S1 | `scripts/tests/api-contract.test.ts` | Test de paridad código↔contrato | — |
| T6 | S4,S5 | `docs/architecture/c4/model.d2` | Modelo C4 con tres vistas | — |
| T7 | S5 | `.github/workflows/ci.yml`, `mise.toml` | Jobs de CI que regeneran y fallan con drift | — |
| T8 | S6 | `README.md`, `ARCHITECTURE.md`, `AGENTS.md` | Mermaid de arquitectura reemplazado por las vistas C4 | — |
| T9 | S7 | repo | Verificación final | — |

## Log

- **L1** — L1 = "Issue 310: feat(repo): contrato y C4 como fuente única, con verificación final"
  Verbatim del issue:
  > Hacer de la API y de la arquitectura fuentes de verdad únicas: un contrato del que se
  > generan la referencia, los tipos/SDKs y las validaciones, y un modelo C4 del que se
  > renderizan las vistas en CI. Cierra el estándar con la verificación de que build y tests
  > pasan. Depende de la arquitectura, de la referencia de docs, del CI base y de las tareas
  > de mise.
  >
  > - [ ] Contrato como única fuente de verdad: la API se define en un contrato (OpenAPI/TypeSpec, Protobuf con buf o JSON Schema); la referencia de `docs/reference/`, los tipos o SDKs y las validaciones se generan de ahí, y el CI falla si lo generado no está al día
  > - [ ] Arquitectura C4 como código: un único modelo (Structurizr DSL o D2) del que salen las vistas de Contexto, Contenedores y Componentes, renderizadas en CI; reemplaza los Mermaid de arquitectura
  > - [ ] Los tests y el build del repo pasan

- **L2** — Decisión de formato: OpenAPI 3.1 en YAML para el contrato y D2 para el modelo C4.
  Motivo: D2 es un binario estático que se instala con mise (versión exacta + checksum en
  `mise.lock`) y no necesita Java, PlantUML ni Graphviz como Structurizr DSL. El SVG de D2
  es determinista con la misma versión, así que el chequeo de drift en CI es confiable.
- **L3** — Decisión de estructura: el contrato se genera en varios artefactos y el CI
  regenera y compara con `git diff --exit-code`. El paquete nuevo es
  `packages/api-contract` (capa L0, sólo contratos).

- **L4** — El contrato quedó en `docs/contract/openapi.yaml` (OpenAPI 3.1, 61 paths, 86
  operaciones, 102 schemas) y de él se generan tres artefactos: la referencia
  `docs/reference/api-http.md`, los tipos `packages/api-contract/src/generated/types.ts` y los
  validadores `packages/api-contract/src/generated/schemas.ts`.
- **L5** — El CI tiene dos jobs nuevos: `contract` (regenera y compara los artefactos, y
  verifica la paridad con las rutas del código) y `c4` (renderiza las vistas y compara). Los
  dos están en el gate `ci-success`.
- **L6** — Se agregaron 4 vistas al modelo D2 (la cuarta es el flujo de datos, que reemplaza
  el flowchart embebido en `README.md` y `ARCHITECTURE.md`). El resto de los Mermaid
  (árboles de decisión) siguen siendo Mermaid: no son diagramas de arquitectura.
- **L7** — Verificación: `mise run lint`, `mise run typecheck`, `mise run test`,
  `mise run test-scripts`, `mise run docs-test`, `mise run build` y `pnpm check:supply-chain`
  en verde.
- **L8** — La revisión nativa (Gentle AI) quedó **pendiente de consentimiento humano**: el
  `assess` devolvió `reviewDue: true` (`nativeRisk: high`, por los procesos que arrancan
  scripts y el shell de los workflows) y el `start` pidió un consentimiento que esta sesión
  desatendida no puede dar. El envelope queda relayado en el mensaje final: la revisión es
  una vista externa opcional y no autoriza la entrega por sí sola.
- **L9** — El check `CodeQL` del PR #321 falló con **4 alertas high** introducidas por este
  trabajo: 2 × `js/file-system-race` (`scripts/generate-api-contract.ts:79` y `:88`, por el
  patrón `existsSync` + escritura) y 2 × `js/incomplete-sanitization`
  (`scripts/lib/api-contract-generator.ts:665` y `:670`, el escapado de pipes sin escapar las
  barras invertidas). Fix: `readIfExists()` (un solo `readFileSync` con `ENOENT`) y
  `escapeMarkdownCell()` (barra invertida primero, pipe después). Verificado con el CodeQL CLI
  real (bundle `codeql-bundle-v2.27.3`): la suite `javascript-security-extended` da 26 alertas
  post-fix, idénticas a las de `origin/main` → 0 nuevas. Control negativo: el código pre-fix
  reproduce las 4 alertas exactas de GitHub.
