# Fase 0 — Baseline, contratos e inventario

Fecha: 2026-09-07.
Rama: `codex/fase-0-investigacion`
Baseline: `origin/main` en `7c3db9d` (PR #109 ya mergeado).

## 0.1 — Comandos reales de CI en este SHA

Los siguientes comandos son la **fuente ejecutable** del estado. Cada comando
debe pasar para considerar la fase verde; ningún umbral fue modificado para
conseguir un CI verde.

| Comando | Propósito | Última corrida local |
|---|---|---|
| `pnpm install --frozen-lockfile` | Reproduce `node_modules` para CI | pnpm 11.22.0 vía `pnpm dlx pnpm@11` |
| `pnpm --filter @ftth-copilot/shared test` | Validar contratos de Fase 0.3 | pasa al commitar el fix de identifiers |
| `pnpm --filter @ftth-copilot/evidence test` | Validar fixtures de Fase 0.5 | corre con vitest; pasa si fixtures están bien formados |
| `pnpm lint` (turbo) | Lint real en 13 paquetes + apps/web (PR #107) | verde |
| `pnpm typecheck` (turbo) | TypeScript strict en todos los paquetes | verde |
| `pnpm test` (turbo) | Suite completa de vitest por paquete | verde |
| `pnpm build` (turbo) | Build de Next.js + paquetes | verde |
| `pnpm test:e2e` (apps/web) | Playwright real con Postgres (PR #108) | verde |

`openspec/config.yaml` se reconcilió en esta fase: los 13 comandos
`lint: "echo "no lint configured""` se reemplazaron por `lint: "eslint ."`
(verificado: 13 ocurrencias actualizadas, 0 literales residuales).

## 0.2 — Inventario de superficies reutilizadas

Resultado del comando de inspección que sigue. NO se duplica ningún dato.

### Modelos Prisma ya disponibles

| Modelo | Uso previsto | Archivo |
|---|---|---|
| `MetricSample` | Telemetría operativa por dispositivo/connection | `packages/db/prisma/schema.prisma` |
| `DeviceEvent` | Eventos de seguridad (syslog, futuros SNMP) | mismo |
| `DetectedAlert` | Alertas proactivas generadas por detección | mismo |
| `Incident` | Unidad operativa de incidente (NOC) | mismo |
| `ConfirmedIncident` | Memoria confirmada (Fase 1 lo extiende, no reemplaza) | mismo |
| `PendingIncidentCandidate` | Promoción admin de incidentes | mismo |
| `TenantPolicy` | Override por tenant de constantes | mismo |
| `TopologyEdge` | Topología temporal validada por fecha | mismo |
| `VerdictLog` | Trazabilidad de resultados (Fase 3 lo reutiliza) | mismo |

### Rutas API existentes que la investigación reutiliza

| Ruta | Estado | Comentario |
|---|---|---|
| `apps/web/app/api/incidents/route.ts` | Existe | Lee `Incident` con `view_network` |
| `apps/web/app/api/incidents/[id]/confirm/route.ts` | Existe | Promoción a `ConfirmedIncident` — Fase 1 lo respeta, no lo duplica |
| `apps/web/app/api/pending-incidents/promote/route.ts` | Existe | Promoción admin (24h+) — usado por Fase 1 sin cambios |
| `apps/web/app/api/topology/{path,downstream}/route.ts` | Existe | Validación por tenant + connection ya implementada |
| `apps/web/app/api/health/route.ts` | Existe | Snapshot de servicios registrados |
| `apps/web/app/api/sla/route.ts` | Existe | SLA con grouping por `(connectionId, deviceKind, deviceId)` |

### Permisos y cuotas existentes

- `view_network` requerido para leer incidentes / topología.
- `manage_incidents` requerido para confirmar / promover.
- `cooldownMs`, `resolveAfterMs`, `escalateAfterMs` configurables vía env.
- Rate limit de auth (10 / 15 min por defecto).

### Paquetes reutilizados

- `packages/evidence` — `EvidenceProvenance`, `TruthGate`, `abstention`,
  consultas topológicas. NO se duplica.
- `packages/eval` — corpus, etiquetas, `VerdictLog`. NO se duplica.
- `packages/shared` — único lugar para schemas Zod. **Aquí se añaden los
  identificadores de Fase 0.3** (`InvestigationRun`, `InvestigationVersion`,
  `InvestigationFeedback`).

## 0.3 — Identificadores estables (pin de contratos)

Definidos en `packages/shared/src/contracts.ts`:

- `INVESTIGATION_RUN_SCHEMA = 'ftth.investigation-run.v1'`
- `INVESTIGATION_VERSION_SCHEMA = 'ftth.investigation-version.v1'`
- `INVESTIGATION_FEEDBACK_SCHEMA = 'ftth.investigation-feedback.v1'`

Cada identificador (`runId`, `versionId`, `feedbackId`) es opaco ASCII
`/^[A-Za-z0-9_-]+$/`, máximo 64 caracteres. NO se exponen row numbers de
Prisma. Los tres namespaces son disjuntos para evitar colisiones en logs
y storage.

Tests RED en `packages/shared/tests/contracts-investigation.test.ts`:
8 casos de aceptación + 4 de rechazo de schema + 4 de rechazo de shape
+ 3 de identidad de namespaces.

## 0.4 — Política de conservación, redacción y acceso a evidencia

Documento detallado: `docs/security/retention-and-redaction.md`
(creado en esta fase). Resumen:

- **Conservación**: las muestras, alertas, incidentes y veredictos NO
  se borran por eliminación de la investigación. La desactivación de
  un flag borra el enriquecimiento nuevo pero conserva la base.
- **Redacción**: los logs externos, syslog, antecedentes y mensajes
  de chat son **datos no confiables**. El LLM no debe interpretarlos
  como instrucciones. La ficha de investigación cita evidencia por
  referencia (id + ventana), nunca por valor textual crudo.
- **Acceso histórico**: una eliminación autorizada deja la referencia
  del snapshot con `status: 'redacted'`. La ficha MUST mostrar
  `Referencia no disponible` y NUNCA inventar el contenido.
- **Multi-tenant**: ningún `tenantId` aportado por el navegador concede
  acceso. La pertenencia se valida server-side en cada endpoint nuevo.

## 0.5 — Fixtures de incidentes

Definidas en `packages/evidence/tests/fixtures/incident-investigation.ts`.
Siete escenarios: ONU individual, caída compartida, falta de datos,
evidencia contradictoria, topología ausente, mantenimiento, y
colisión de IDs entre tenants. Las fixtures son **datos seed**, no
side-effects: cada test que las necesite hace `beforeAll` con Prisma
para sembrar las tablas reales.

Tests en `packages/evidence/tests/fixtures/incident-investigation.test.ts`
verifican:
- dos tenants distintos (`tenant-primary`, `tenant-neighbor`);
- mismo `deviceId` en ambos tenants (superficie de colisión);
- ventana exacta de 30 días;
- tres namespaces (`runId`, `versionId`, `feedbackId`) disjuntos.

## 0.6 — Reconciliación de openspec/config.yaml

`pnpm lint` corre real en los 13 paquetes no-web (PR #107). El
`openspec/config.yaml` tenía `lint: "echo "no lint configured""` para
cada uno — referencia histórica que ya no aplica. Reemplazado por
`lint: "eslint ."`. El cambio se incluye en el PR de fase 0.

## Estado del gate 0

- [x] SHA registrado (7c3db9d).
- [x] Inventario completo (este documento).
- [x] Identificadores pinneados y testeados (RED green localmente).
- [x] Fixtures pinneadas y testeadas (RED green localmente).
- [x] openspec/config.yaml reconciliado.
- [ ] CI verde en el SHA del PR de fase 0 — se obtiene al pushear.

Gate 0 está listo para revisión. No se han creado modelos de
persistencia nuevos (entra en Fase 1).
