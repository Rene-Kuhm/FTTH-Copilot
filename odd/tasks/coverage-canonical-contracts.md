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
| T1 | S1, S2, S3 | `packages/investigations` | `packages/investigations/tests/`, `packages/investigations/vitest.config.ts` | `test(investigations): ...` |
| T2 | S1, S2, S3 | `apps/web` | `apps/web/tests/lib/monitoring/` | `test(web): ...` |
| T3 | S4, S7, S9 | `packages/shared` + `packages/evidence` | `packages/shared/src/`, `packages/shared/tests/`, `packages/shared/package.json`, `packages/evidence/src/`, `packages/evidence/package.json` | `refactor(shared): ...` |
| T4 | S5, S7, S9 | `packages/shared` + `packages/analytics` + `packages/alerts` | `packages/shared/src/`, `packages/analytics/src/`, `packages/analytics/package.json`, `packages/alerts/src/`, `packages/alerts/package.json` | `refactor(shared): ...` |
| T5 | S6, S7, S9 | `packages/shared` + `packages/agent-core` + `packages/detection` | `packages/shared/src/`, `packages/agent-core/src/`, `packages/detection/src/`, tests de los tres | `refactor(shared): ...` |

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
