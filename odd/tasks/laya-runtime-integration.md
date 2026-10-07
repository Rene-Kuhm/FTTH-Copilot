# Task: Laya Runtime Integration

**ID**: LAYA-RT
**Status**: in_progress
**Created**: 2026-10-07
**Priority**: high
**Branch**: `feat/laya-runtime-integration`
**Spec**: `openspec/changes/laya-runtime-integration/`

## Problem

ADR-042 declara la Laya Decision Layer como `Estado: Implementado`, pero en runtime la capa
está cortada por una sola punta. Auditoría en `main@6b34a48`:

- `packages/agent-core/src/adaptive-router.ts:361-370` **ya clasifica cada consulta** con el
  expert system y escribe `eventClass`/`eventConfidence` en el `DiagnosticRoute`.
- `apps/web/lib/metrics/prometheus.ts:3,313` **ya publica** la familia `ftth_laya_*` llamando
  `layaMetrics.toPrometheusFormat()`.
- **Nadie escribe en `layaMetrics`.** El único escritor (`recordLayaDecision`) vive en
  `packages/shared/src/laya-client.ts`, que no es alcanzable: no está exportado desde
  `packages/shared/src/index.ts` y ningún módulo fuera de `packages/shared` lo importa.

Consecuencia medida: `toPrometheusFormat()` (`laya-metrics.ts:113-156`) emite los 6 renglones
`# HELP`/`# TYPE` y **cero muestras**. El parser de `apps/web/components/LayaMetricsPanel.tsx:39`
busca `^ftth_laya_requests_total\{...}` y nunca matchea. El dashboard `/dashboard/laya` muestra
para siempre *"Sin decisiones registradas aún"* e instruye al operador a poner
`LAYA_ENABLED=true`, que no cambia nada.

## Defectos confirmados que entran en el alcance

| # | Defecto | Evidencia |
|---|---|---|
| D1 | Defaults contradictorios para la misma env | `laya-shadow.ts:192` `LAYA_ENABLED !== 'false'` (**encendido**) vs `laya-client.ts:47` `LAYA_ENABLED === 'true'` (**apagado**) |
| D2 | Nadie graba la decisión en `layaMetrics` | único escritor en `laya-client.ts` (inalcanzable) |
| D3 | Colisión de nombres: dos `recordLayaDecision` con firmas incompatibles | `laya-metrics.ts:169` `(eventClass, confidence, mode, result, latencyMs?, suggestedRoute?)` vs `laya-client.ts:240` `(metrics, params)`. Bloquea exportar `laya-client` (TS2308) |
| D4 | `laya-client.ts`/`laya-integration.ts` no exportados | `packages/shared/src/index.ts:135-137` exporta solo `laya-expert-system`, `laya-metrics`, `laya-shadow` |
| D5 | Modos `assisted`/`automatic` del ADR no conectados | `selectMode` (`adaptive-router.ts:217`) no tiene input de Laya; `mergeRoutingDecision` sin callers |
| D6 | El circuit breaker abre en silencio | `laya-client.ts:150` documenta `recordFailure: () => boolean` y los 3 call sites (`:502`, `:533`, `:582`) descartan el valor |
| D7 | La respuesta de Laya nunca se valida | `layaDecisionSchema` importado en `laya-client.ts:25` y `laya-integration.ts:24` y sin usar; la salida sí se valida (`laya-integration.ts:245`) |
| D8 | Las `LAYA_*` no están declaradas en Turbo | `turbo.json` `globalEnv` con 0 referencias → cambio de env no invalida cache |
| D9 | `.env.example` con dos bloques Laya duplicados y puerto equivocado | bloques en `:196-242` y `:244-282`; `LAYA_URL=...:8000` en `:224` y `:268` vs `laya-client.ts:368` `:8080` y `docker-compose.yml:47` `8080` |
| D10 | El servicio `laya` no está en demo ni prod | solo `docker-compose.yml:35` bajo `profiles: [laya]`; `docker-compose.demo.yml` y `docker-compose.prod.yml` con 0 referencias |

## Fuera de alcance

- Reentrenar o reemplazar el expert system (la accuracy 94.4% no se audita acá).
- Reescribir la narrativa pública de README/ADR más allá de alinear el estado con lo verificado.

## Acceptance Criteria

1. Con `LAYA_ENABLED=true` y `LAYA_MODE=shadow`, una consulta real produce muestras
   `ftth_laya_requests_total{...}` visibles en `GET /api/metrics` (hoy: 0 muestras).
2. El panel `/dashboard/laya` muestra datos reales y su instrucción al operador es verdadera.
3. `LAYA_ENABLED` tiene un único default en todo el repo, verificado por test.
4. Con `LAYA_MODE=assisted|automatic`, la señal de Laya puede cambiar la ruta; con `shadow`
   NO cambia la ruta, solo registra. Con `disabled`, no se consulta nada.
5. Un fallo del clasificador o del servicio no rompe el pipeline (fail-open) y sí queda registrado.
6. Los gates pasan con evidencia sin cache: `typecheck`, `lint`, `test` con `--force`,
   más `check:sources` y `check:contribution`.

## Verification evidence

### Fases 1 y 2 — CERRADAS (sin commit todavía, working tree)

`resolveLayaEnv()` agregado; `getLayaConfig()` y `loadLayaConfigFromEnv()` delegan en él.
El circuito está cerrado: `runtime.ts` graba en `layaMetrics` en el call site de orquestación.

| Verificación | Comando | Resultado |
|---|---|---|
| Typecheck sin cache | `turbo run typecheck --force` | 17/17, `0 cached` |
| Lint sin cache | `turbo run lint --force` | 17/17, `0 cached` |
| Tests sin cache | `turbo run test --force` | 17/17, `0 cached` |
| Validador CI | `pnpm check:sources` | ✅ 17 vendors, sin drift |
| Validador CI | `pnpm check:contribution` | ✅ 17 vendors limpios |

**Criterio de aceptación 1 (el que importa) — verificado de forma independiente.**
Con `LAYA_ENABLED=true`, `toPrometheusFormat()` emite muestras reales (antes: cero):

```
ftth_laya_requests_total{event_class="OPTICAL_FAULT",mode="shadow",result="success"} 1
ftth_laya_requests_total{event_class="NORMAL",mode="shadow",result="success"} 1
ftth_laya_latency_ms{mode="shadow",quantile="p50"} 6
```

### Red tests observados (evidencia RED, no solo GREEN)

- `expected +0 to be 1` / `expected +0 to be 2` / `expected 0 to be greater than 0` al probar
  la grabación antes de cablear el hook.
- `expected undefined to be 'SOME_CLASS'` al invertir el check negativo que prueba que el mock
  del clasificador está realmente activo.
- `expected 'disabled' to be 'shadow'` en `laya-client.test.ts`, que afirmaba el default viejo.

### Lo que NO se verificó

- **No se ejercitó `GET /api/metrics` contra un servidor Next.js vivo** (no hay Docker ni server
  en este entorno). Se verificó la capa de formato (`toPrometheusFormat()`), que es la misma
  función que llama `prometheus.ts:313`. Es una inferencia, no una medición.
- No se corrió `test:e2e` (16 specs Playwright, requieren Postgres + `db:deploy` + `db:seed`),
  ni `db test:integration`, ni `alerts test:integration`.

### Defecto de proceso registrado

El primer writer editó `packages/shared/tests/laya-shadow.test.ts`, fuera de las superficies que
le declaré, y dejó `laya-client.test.ts` en rojo por no estar en la lista. La edición fue
correcta en sustancia; la brecha de superficie se registra para que la próxima delegación incluya
los archivos de test que el cambio va a perturbar.

### Fases 3 y 4 — CERRADAS (commits `d79a670` y `d0ad43f`)

**Fase 3** — `laya-client` y `laya-integration` exportados desde el entry del paquete.
Solo **una** colisión real: `laya-integration.ts` declaraba un `LayaDecision` idéntico al que ya
importaba de `laya-shadow.ts`; se eliminó el duplicado. `recordLayaDecision` de `laya-client.ts`
renombrado a `recordLayaCallOutcome`. Verifiqué el diff de `index.ts`: dos `export *`, ningún
símbolo previamente público perdió su nombre.

**Fase 4** — los cuatro modos son reales. Decisión de diseño clave (AD-6, documentada en
`design.md`): la señal de Laya entra como **input de `planRoute`**, no como override posterior,
porque `planRoute` deriva `tools` y `maxIterations` del modo: un override post-hoc deja una ruta
promovida a `investigation` con `maxIterations: 0`, el loop nunca corre y el agente contesta como
si hubiera investigado. `shadow` pasa señal nula, así no puede cambiar la ruta por construcción.

| Verificación | Comando | Resultado |
|---|---|---|
| Typecheck sin cache | `turbo run typecheck --force` | 17/17, `0 cached` |
| Lint sin cache | `turbo run lint --force` | 17/17, `0 cached` |
| Tests sin cache | `turbo run test --force` | 17/17, `0 cached` |
| Tests de agent-core | `--filter=@ftth-copilot/agent-core` | 16 archivos, 293 tests |

### Sospecha revisada y descartada (no repetir)

Sospeché que el camino `assisted` era inconsistente: llama `mergeRoutingDecision` para respetar los
umbrales y después re-llama `planRoute({layaSignal})`, que aplica el `suggestedRoute` crudo. Leí
`mergeRoutingDecision`: sus únicas salidas no-adaptativas son `'direct'` (solo si
`suggestedRoute === 'DIRECT'`) e `'investigation'` (solo si `=== 'INVESTIGATION'`). Cuando decide
diferir, el mapeo crudo da exactamente el mismo modo. Es autoconsistente, no un bug.

### Defecto nuevo encontrado en la revisión de la Fase 4 (task 5.5)

Los thresholds de confianza se resuelven **dos veces**: `laya-client.ts:57-60` y
`runtime.ts:388-389`, los dos con fallbacks idénticos `0.95`/`0.75`. Es la misma clase de defecto
que D1, que la Fase 1 eliminó. Los valores coinciden hoy, así que es riesgo de divergencia, no bug
vivo. Trackeado como task 5.5.

### Fases 5 a 7 — CERRADAS

**Fase 5.** Breaker observable: la rama `shadow` ya reportaba la apertura; se agregó el mismo
reporte a la rama **activa** (líneas 667 y 716 de `laya-client.ts`), donde el boolean se
descartaba. Validación inbound: el mapper valida con `layaDecisionSchema` y devuelve `null` ante
payload inválido. `LAYA_*` declaradas en `turbo.json` `globalEnv`.

**Task 5.5 (thresholds duplicados).** Resueltos en un solo lugar: `resolveLayaEnv()`
en `laya-shadow.ts:208-209` es ahora el único punto que lee
`LAYA_CONFIDENCE_THRESHOLD_HIGH` / `_LOW`, y tanto `laya-client.ts` como `runtime.ts` consumen el
valor resuelto. Verificado con `grep -rn "CONFIDENCE_THRESHOLD" packages/shared/src packages/agent-core/src`:
sólo aparece en el resolver.

**Fase 6.** Servicio `laya` en demo y prod (opt-in por profile) y `docker-compose.prod.yml`
validando (`exit 0`) después de declarar los volúmenes que sus servicios montaban sin declarar.
`.env.example` de-duplicado y con el puerto corregido a 8080. `.env.prod` y `.env.demo` agregados
al `.gitignore`: el nombre exacto que prod exige estaba sin ignorar. ADR-042, README,
`docs/architecture.md` y `docs/aiops-roadmap.md` alineados con el estado verificado.

**Fase 7.** Gates con cache invalidado, y esta vez **incluyendo el build**.

| Verificación | Resultado |
|---|---|
| `turbo run build --force` | 2/2, `0 cached` |
| `turbo run typecheck --force` | 17/17, `0 cached` |
| `turbo run lint --force` | 17/17, `0 cached` |
| `turbo run test --force` | 17/17, `0 cached` |
| `pnpm check:sources` / `pnpm check:contribution` | ✅ los dos |
| `docker compose config -q` demo / prod | `exit 0` los dos |
| CI del PR #297 | verde, incluidos Playwright E2E e Integration Tests (Postgres) |

### Lección de proceso que costó un CI rojo

El primer CI del PR #297 falló en el job `Build` con
`Module not found: Can't resolve './laya-shadow.js'`. Causa: `laya-client.ts` ya importaba
`'./laya-shadow.js'` pero como **import type**, que se borra al compilar; al volverlo import de
**valor** (`resolveLayaEnv`) dejó de borrarse, y con la Fase 3 exportando esos módulos desde el
índice entraron al grafo de webpack del build de Next, que no mapea un especificador `.js` a un
archivo `.ts`. Arreglado alineando la convención del paquete (sin extensión).

**Por qué se escapó**: `turbo run build --force` se corrió temprano y nunca más después del commit
que cambió el grafo de imports. Typecheck, lint y tests estaban verdes con el build roto: `tsc`
resuelve `.js` → `.ts` y webpack no. **Regla**: correr el build después de cualquier cambio que
meta un módulo nuevo al grafo de la app, y correr la suite completa al final, no sólo al principio.

### Estado git (final)

PR **#297 mergeado** a `main` (merge commit `7e9e10e`), CI verde. Los follow-ups de esta última
tanda van en `feat/laya-followups`, PR separado. `main` limpio y actualizado.

### Lo que quedó fuera, a propósito

- No hubo **review nativo independiente**: el pipeline de RDD no pudo ejecutar (no hay modelo
  asignado a los lenses). La verificación es del autor y no reemplaza un review independiente. Está
dicho explícitamente en el cuerpo del PR #297.
- El servicio Python nunca se ejecutó en local (falta `fastapi`): el contrato se verificó leyendo
  `services/laya/app.py` contra `layaDecisionSchema` y con tests, no con un round-trip HTTP real.

<!--
Notas de auditoría (para el revisor):
- El "PASS" de `pnpm typecheck` sin `--force` es `cache=HIT`: no es evidencia. Verificado con
  `turbo run typecheck --dry=json` (17/17 cache=HIT) y con `--force` (17/17, 0 cached).
- El gate local (`pnpm test`) NO cubre lo que sí cubre CI: `test:coverage-check`, `test:e2e`
  (16 specs Playwright con Postgres + seed + login real), `db test:integration`,
  `alerts test:integration`, ni `pnpm build`.
-->
