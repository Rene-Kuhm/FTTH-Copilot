# Cobertura de módulos sin tests y contratos canónicos de dominio

**Estado**: En curso
**Creado**: 2026-10-31
**Alcance**: Dos unidades de trabajo sobre `origin/main` (v0.8.0), independientes entre sí
por rama. (1) Cobertura de comportamiento de módulos con 0% o muy baja cobertura.
(2) Contratos canónicos de dominio: una sola fuente para los tipos duplicados y una sola
constante para el umbral de RX power degradado.
**Relacionadas**: `ARCHITECTURE.md`, `packages/shared`, `packages/evidence`,
`packages/analytics`, `packages/alerts`, `packages/investigations`

---

## Specs

### S1 — Medición real de cobertura

> Medí la cobertura actual real con 'pnpm test:coverage-check'/vitest --coverage, y escribí
> tests de COMPORTAMIENTO (no de implementación) que cubran caminos reales y bordes (errores,
> tenant-aware, límites de cuota, tiempos inyectados), empezando por investigations/pipeline.ts
> (orquesta lectura de varias tablas Prisma: usá dobles).

### S2 — Atomicidad de los commits de tests

> Un commit por módulo/unidad de comportamiento (test:).

### S3 — Bugs reales encontrados

> Si al testear descubrís un BUG real, corregilo test-first en commit propio (fix:) y reportalo.
> No bajes umbrales de cobertura.

### S4 — Contratos canónicos (a): dependencia shared → evidence

> packages/shared/src/index.ts importa tipos de @ftth-copilot/evidence (L0→L1: dependencia hacia
> arriba, contra ARCHITECTURE.md): eliminala de forma que la dependencia vaya hacia abajo (evidence
> importa de shared, o el tipo baja a shared) y quitá la dependencia de package.json si queda sin uso;
> VerdictCode está duplicado en shared/src/contracts.ts y evidence/src/types.ts: dejá UNA fuente.

### S5 — Contratos canónicos (b): tipos de dominio duplicados

> MetricKind/DeviceKind/DeviceStatus/SampleMeta idénticos en packages/analytics/src/types.ts y
> packages/alerts/src/types.ts: una sola definición en @ftth-copilot/shared (o la capa correcta) y
> reexport sin romper la API pública.

### S6 — Contratos canónicos (c): umbral de RX power degradado

> El umbral de -27 dBm: packages/agent-core/src/alerts.ts:76 lo usa como literal mientras
> scheduler/src/event-points.ts define DEFAULT_DEGRADED_RX_THRESHOLD_DBM (y
> detection/src/signal-drift.ts): unificá en una constante compartida sin cambiar comportamiento
> (tests de caracterización antes).

### S7 — Contrato HTTP y arquitectura intactos

> NO cambies la API pública ni el contrato OpenAPI (pnpm contract:check debe seguir verde); pnpm
> c4:check también; actualizá docs/ARCHITECTURE.md si afirman algo que cambia.

### S8 — Límites de entrega

> Commits atómicos locales, Conventional Commits 1.0.0 en español, SIN 'Co-Authored-By' ni
> atribución de IA. NO push, NO PR (los abre el supervisor).

### S9 — Restricciones de superficie

> NO toques superficies protegidas (AGENTS.md §6: migraciones de prisma, packages/db/src/generated,
> research/olt, docs/compatibility-matrix.md, packages/eval, golden snapshots,
> openspec/changes/archive, LICENSE). Si un cambio necesita una migración de Prisma u otra
> superficie protegida, PARATE en ese ítem y reportalo.

---

## Tasks

| ID | Specs | Ruta | Superficie | Commit |
|---|---|---|---|---|
| T1 | S1, S2, S3 | `packages/investigations` | `packages/investigations/tests/`, `packages/investigations/vitest.config.ts` | `7658451` test(investigations): cobertura de comportamiento del pipeline · `b18b64a` test(investigations): cobertura de comportamiento de la cuota |
| T2 | S1, S2, S3 | `apps/web` | `apps/web/tests/lib/monitoring/` | `d61b3df` test(web): cobertura de comportamiento del monitoreo de salud |
| T3 | S4, S7, S9 | `packages/shared` + `packages/evidence` | `packages/shared/src/`, `packages/shared/tests/`, `packages/shared/package.json`, `packages/evidence/src/`, `packages/evidence/tests/` | `20d8b1c` refactor(shared): el veredicto vive en shared y evidence lo reexporta |
| T4 | S5, S7, S9 | `packages/shared` + `packages/analytics` + `packages/alerts` | `packages/shared/src/`, `packages/shared/tests/`, `packages/analytics/`, `packages/alerts/` | `b150c11` refactor(shared): los tipos de dominio quedan en shared |
| T5 | S6, S7, S9 | `packages/shared` + `packages/agent-core` + `packages/detection` | `packages/shared/src/`, `packages/shared/tests/`, `packages/agent-core/`, `packages/detection/` | `578e898` refactor(shared): el umbral de rx power degradado vive en shared |

Plan: `503f956` docs(odd): plan de cobertura de modulos y contratos canonicos

Ramas:

- T1 y T2 → `test/zero-coverage-modules` (base `origin/main`).
- T3, T4, T5 → `refactor/canonical-domain-contracts`, rama apilada sobre
  `test/zero-coverage-modules`.

---

## Log

### L1 — Pedido original (verbatim)

> Sos un ingeniero de FTTH-Copilot trabajando EN ESTE WORKTREE (rama test/zero-coverage-modules, base origin/main). Leé AGENTS.md y apps/web/AGENTS.md primero. Hay OTROS 3 agentes trabajando en paralelo en worktrees hermanos: NO toques ningún directorio fuera de este worktree, ni ../FTTH-Copilot*, ni sus ramas.
>
> REGLAS:
> - Test-first: el test nuevo debe FALLAR sin el cambio; mostrá RED y GREEN reales.
> - Commits atómicos locales, Conventional Commits 1.0.0 en español, SIN 'Co-Authored-By' ni atribución de IA. NO push, NO PR (los abre el supervisor).
> - Mínimo cambio, sin refactors no pedidos, sin 'any', tenant-aware, sin datos reales ni .env reales/secretos. NO toques superficies protegidas (AGENTS.md §6: migraciones de prisma, packages/db/src/generated, research/olt, docs/compatibility-matrix.md, packages/eval, golden snapshots, openspec/changes/archive, LICENSE). Si un cambio necesita una migración de Prisma u otra superficie protegida, PARATE en ese ítem y reportalo.
> - NO corras scripts/snmp-benchmark.ts ni 'rust-anything profile' (mutan superficies protegidas).
> - Respondé NO a cualquier consentimiento/review nativa de Gentle AI (no la ejecutes en esta tarea); reportá "review no corrida".
> - Si usás Postgres/Redis/servidores: docker descartables, datos sintéticos, SOLO estos puertos: 55520-55529, 16520-16529, 3520-3529. No mates procesos ni contenedores que no creaste (ftth-test-* y otros no son tuyos). Limpiá todo al terminar (contenedores, volúmenes, temporales). Corré siempre comandos largos con stdin cerrado.
> - Verificación antes de cada commit: pnpm install si falta; pnpm turbo run lint typecheck test --filter <paquetes afectados>; al final pnpm turbo run lint typecheck test --force (todo el monorepo) más pnpm contract:check y pnpm c4:check si tocaste contratos/arquitectura/docs de arquitectura. Si algo falla, compará contra origin/main antes de atribuirlo.
> - Reportá al final: hashes, archivos, evidencia RED/GREEN y de gates, qué NO pudiste verificar, y decisiones que requieren al dueño. No declares verde lo que no corrió. Si un ítem es inviable o ambiguo, no inventes: explicalo y seguí con el siguiente.
>
> TAREA:
> Parte de origin/main (v0.8.0), no depende de otros PR.
> Ítem 1 — COBERTURA: pnpm test:coverage-check reportó (según un agente previo, NO verificado por mí; verificá vos primero) módulos al 0% o muy bajos: packages/investigations/src/pipeline.ts y quota.ts, event-ingest.ts, scheduler-health.ts, worker-health.ts (19%/9% branches), apps/web/lib/monitoring (63%/50%). Medí la cobertura actual real con 'pnpm test:coverage-check'/vitest --coverage, y escribí tests de COMPORTAMIENTO (no de implementación) que cubran caminos reales y bordes (errores, tenant-aware, límites de cuota, tiempos inyectados), empezando por investigations/pipeline.ts (orquesta lectura de varias tablas Prisma: usá dobles). Un commit por módulo/unidad de comportamiento (test:). Si al testear descubrís un BUG real, corregilo test-first en commit propio (fix:) y reportalo. No bajes umbrales de cobertura.
> Ítem 2 — CONTRATOS CANÓNICOS (rama NUEVA apilada: git switch -c refactor/canonical-domain-contracts): (a) packages/shared/src/index.ts importa tipos de @ftth-copilot/evidence (L0→L1: dependencia hacia arriba, contra ARCHITECTURE.md): eliminala de forma que la dependencia vaya hacia abajo (evidence importa de shared, o el tipo baja a shared) y quitá la dependencia de package.json si queda sin uso; VerdictCode está duplicado en shared/src/contracts.ts y evidence/src/types.ts: dejá UNA fuente. (b) MetricKind/DeviceKind/DeviceStatus/SampleMeta idénticos en packages/analytics/src/types.ts y packages/alerts/src/types.ts: una sola definición en @ftth-copilot/shared (o la capa correcta) y reexport sin romper la API pública. (c) El umbral de -27 dBm: packages/agent-core/src/alerts.ts:76 lo usa como literal mientras scheduler/src/event-points.ts define DEFAULT_DEGRADED_RX_THRESHOLD_DBM (y detection/src/signal-drift.ts): unificá en una constante compartida sin cambiar comportamiento (tests de caracterización antes). NO cambies la API pública ni el contrato OpenAPI (pnpm contract:check debe seguir verde); pnpm c4:check también; actualizá docs/ARCHITECTURE.md si afirman algo que cambia. Si un refactor es demasiado riesgoso, hacelo parcial y reportalo.

### L2 — Medición real de la cobertura (antes de escribir tests)

- `pnpm --filter @ftth-copilot/investigations test:coverage` → **0/0**: `packages/investigations/vitest.config.ts`
  incluye `tests/**/*.test.ts` y excluye `tests/**/*.integration.test.ts`, así que la corrida unitaria
  no encuentra **ningún** archivo de test, y no hay bloque `coverage` con `include`, por lo que la
  cobertura de `src/**` nunca se mide. El "0%" reportado no era una medición de `pipeline.ts` ni de
  `quota.ts`: era un paquete sin tests unitarios ejecutados.
- `packages/scheduler/src/event-points.ts` **no existe** en esta base (v0.8.0) y
  `DEFAULT_DEGRADED_RX_THRESHOLD_DBM` no aparece en ningún archivo. El umbral equivalente sí existe
  como literal en `packages/agent-core/src/alerts.ts:77` y como default en
  `packages/detection/src/signal-drift.ts:26`.
- `MetricKind`/`DeviceKind` tienen una **tercera** definición (enum Prisma) reexportada por
  `packages/db/src/index.ts` desde `packages/db/src/generated/client/index.js`. Ese archivo es
  superficie protegida y no se puede tocar: la unificación de S5 vive en `@ftth-copilot/shared` y
  las definiciones de analytics/alerts pasan a reexportar de ahí.
- `packages/eval` (superficie protegida) importa `Verdict`, `VerdictCode` y `VerdictSeverity` desde
  `@ftth-copilot/evidence`. Para no tocarlo, `evidence` debe **reexportar** los tipos canónicos
  desde `shared`, de modo que la API pública de `evidence` no cambie y el import hacia arriba
  desaparezca sólo de `shared`.

### L3 — Ítem 1 (COBERTURA): resultado en `test/zero-coverage-modules`

RED medido antes de escribir (no estimado):

- `packages/investigations`: `pnpm --filter @ftth-copilot/investigations test:coverage` → `No test
  files found`, 0/0 en las cuatro métricas. La corrida unitaria excluía
  `tests/**/*.integration.test.ts` y el package no tenía bloque `coverage`, así que `src/**` nunca
  se midió.
- `apps/web`: `lib/monitoring` en 63.54% stmts / 75.75% branch / 50% funcs / 62.79% lines. El
  "19%/9% branches" del enunciado corresponde a `worker-health.ts` (19.51% / 9.09% / 7.14% / 21.05%),
  no al directorio.

GREEN medido después:

| Módulo | Antes | Después |
|---|---|---|
| `investigations/src/pipeline.ts` | no medido (0/0) | 100% stmts (23/23), 100% branch (6/6), 100% funcs (8/8), 100% lines (20/20) |
| `investigations/src/quota.ts` | no medido (0/0) | 100% stmts (26/26), 100% branch (12/12), 100% funcs (6/6), 100% lines (26/26) |
| `apps/web/lib/monitoring` (directorio) | 63.54 / 75.75 / 50 / 62.79 | 100 / 98.48 / 100 / 100 |
| `apps/web/lib/monitoring/worker-health.ts` | 19.51 / 9.09 / 7.14 / 21.05 | 100 / 100 / 100 / 100 |
| `apps/web/lib/monitoring/connection-health.ts` | 94.87 / 89.13 / 100 / 93.93 | 100 / 100 / 100 / 100 |
| `apps/web/lib/monitoring/database-health.ts` | 100 / 88.88 / 100 / 100 | 100 / 88.88 / 100 / 100 |

- 16 tests nuevos en `packages/investigations` (8 de pipeline, 8 de quota) y 5 archivos de test en
  `apps/web/tests/lib/monitoring/`.
- Se agregó `coverage.include: ['src/**/*.ts']` a `packages/investigations/vitest.config.ts`
  para que la cobertura del package sea medible. **Sin thresholds nuevos** y **sin bajar ninguno**:
  el package no tenía umbrales y los de `apps/web` (22/22/18/15) quedaron intactos.
- `database-health.ts` conserva una rama sin cubrir (88.88% branch): la línea 31 hace
  `if (timer) clearTimeout(timer)` y `timer` se asigna de forma sincrónica dentro del executor de
  `new Promise`, así que la rama `false` es inalcanzable por construcción.
- **Bugs reales encontrados: ninguno.** Los dos writers buscaron fallos de comportamiento y no
  encontraron ninguno; por eso no hay commit `fix:`.

### L4 — Ítem 2 (CONTRATOS CANÓNICOS): resultado en `refactor/canonical-domain-contracts`

Rama apilada sobre `test/zero-coverage-modules`. Tres unidades de comportamiento, tres commits.

- **T3 (`20d8b1c`)** — `Verdict`, `VerdictCode` y `VerdictSeverity` quedan definidos **una sola
  vez** en `packages/shared/src/contracts.ts` (`VerdictCode` y `VerdictSeverity` derivados de los
  schemas Zod que ya existían). `packages/evidence/src/types.ts` los **reexporta** desde
  `@ftth-copilot/shared`, de modo que la API pública de `evidence` no cambia y `packages/eval`
  (superficie protegida) sigue importando desde `evidence` sin haber sido tocado. Se eliminó el
  `import type { Verdict, VerdictCode } from '@ftth-copilot/evidence'` de `packages/shared/src/index.ts`
  y con él el `peerDependencies['@ftth-copilot/evidence']` de `packages/shared/package.json`. La
  guarda anti-deriva se mudó a `packages/evidence/tests/verdict-contract.test.ts`, que es la capa
  que puede ver ambas fuentes.
- **T4 (`b150c11`)** — `DeviceKind`, `MetricKind`, `DeviceStatus` y `SampleMeta` quedan en
  `packages/shared/src/domain.ts`. `analytics` y `alerts` los reexportan y conservan exactamente
  los mismos nombres públicos (`alerts` no expone `SampleMeta`, porque nunca lo expuso). Se
  descubrió y unificó una **tercera** copia de `DeviceStatus` en `packages/analytics/src/sla.ts`.
  `analytics` y `alerts` declaran ahora `@ftth-copilot/shared` como dependencia (L2 → L0, sin
  ciclos). `packages/analytics/tests/prisma-enum-sync.test.ts` verifica en runtime y a nivel de
  tipos que la unión canónica tiene exactamente los mismos miembros que los enums Prisma de
  `@ftth-copilot/db` (que no se tocó: es superficie protegida).
- **T5 (`578e898`)** — `DEFAULT_DEGRADED_RX_THRESHOLD_DBM = -27` queda en
  `packages/shared/src/constants.ts` y reemplaza los literales de `agent-core/src/alerts.ts`,
  `agent-core/src/investigation-facts.ts`, `detection/src/signal-drift.ts`,
  `agent-core/src/prompts/system.ts` y `agent-core/src/tools/index.ts`. `detection` no declaraba
  ninguna dependencia y ahora declara `@ftth-copilot/shared`.

Cero cambio de comportamiento en T5, demostrado con tests de caracterización previos: el prompt
(`- **RX power en atención**: -25 a -27 dBm` / `- **RX power con problema**: < -27 dBm (posible
corte de fibra, conector sucio, ONU defectuosa)`), la descripción de la herramienta
(`Umbral de RX power. Sugeridos: -25 (atención), -27 (problema). Son los mismos umbrales que usa el
motor de detección.`) y el mensaje de la alerta (`ONU onu-below (Debajo) tiene RX power de -27.1
dBm (umbral: -27 dBm).`) quedan idénticos byte a byte.

`pnpm contract:check` (89 operaciones, 3 artefactos) y `pnpm c4:check` (4 vistas) en verde en las
tres unidades. `docs/architecture/c4/model.d2` no modela las aristas tocadas, así que no se regeneró
ninguna vista. `ARCHITECTURE.md` sí afirmaba la tabla de dependencias por capa: se actualizó en el
mismo commit de cada cambio (T4 y T5).

### L5 — Límites de lo entregado

- `packages/scheduler/src/event-points.ts` **no existe** en v0.8.0 y
  `DEFAULT_DEGRADED_RX_THRESHOLD_DBM` no aparecía en ningún archivo de la base. La equivalencia
  real era el literal de `agent-core/src/alerts.ts` y el default de `detection/src/signal-drift.ts`.
  Se usó ese nombre para el canónico, sin inventar el módulo ausente.
- `event-ingest.ts`, `scheduler-health.ts` y `worker-health.ts` **no están** en
  `packages/investigations`: viven en `apps/web/lib/monitoring/`. Los tres se cubrieron ahí.
- Quedan fuera de alcance, reportados para el dueño: `packages/detection/src/types.ts` define su
  propio `DeviceKind` (semántica de detector, no la de telemetría) y
  `apps/web/components/FiberPlanViewer.tsx` define un `DeviceKind` más ancho
  (`PON_PORT | SPLITTER | CTO | ONU | OLT`) que es el del plano de fibra, no el de telemetría.
- El umbral de "atención" de -25 dBm sigue como literal en `investigation-facts.ts` y en los textos
  del prompt y de la herramienta: el pedido nombraba sólo -27.
- No se ejecutó `pnpm test:e2e` (Playwright, requiere Postgres) ni los tests de integración que
  requieren base real.

### L6 — Gates finales (ejecutados sobre `refactor/canonical-domain-contracts`)

| Gate | Comando | Resultado |
|---|---|---|
| Lint + types + tests del monorepo | `pnpm turbo run lint typecheck test --force` | **73/73 tareas exitosas**, 0 cacheadas, 25.0s. 0 errores de ESLint. 1 warning preexistente en `apps/web/app/layout.tsx:70` (`@next/next/no-page-custom-font`), archivo que ninguna de las unidades tocó. |
| Contrato HTTP | `pnpm contract:check` | exit 0 — `contrato al día: 89 operaciones, 3 artefactos.` |
| Arquitectura C4 | `pnpm c4:check` | exit 0 — `vistas C4 al día: 4 vistas.` |

Los tres gates correron sobre el árbol completo, con la rama Item 2 apilada encima de Item 1.

### L7 — Límites de slice para la publicación

La rama `refactor/canonical-domain-contracts` es apilada sobre `test/zero-coverage-modules`, así
que el diff de Item 2 contra `test/zero-coverage-modules` son 3 commits (~250 líneas de fuente y
tests). El diff completo contra `origin/main` son 7 commits y ~1.760 líneas, por encima del slice
de ~400 líneas: **el supervisor decide la forma de publicación** (PR encadenado por unidad de
comportamiento).
