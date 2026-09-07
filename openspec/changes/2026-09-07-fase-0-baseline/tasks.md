# Tareas — Fase 0

## 0.1 Actualizar referencias remotas y registrar SHA

- [ ] Verificar `git fetch origin` y `git status` limpios.
- [ ] Registrar el SHA revisado en `docs/validation/fase-0-baseline.md`.

## 0.2 Inventariar superficies reutilizadas

- [ ] Listar modelos Prisma (`Incident`, `DetectedAlert`,
      `MetricSample`, `DeviceEvent`, `ConfirmedIncident`,
      `PendingIncidentCandidate`, `TenantPolicy`, `TopologyEdge`,
      `VerdictLog`) — confirmar que no se duplica ninguno.
- [ ] Listar rutas API existentes que la investigación reutiliza
      (`/api/incidents`, `/api/incidents/[id]/confirm`,
      `/api/pending-incidents/promote`, `/api/topology/*`,
      `/api/health`, `/api/sla`).
- [ ] Confirmar permisos (`view_network`, `manage_incidents`) y
      cuotas (`AUTH_RATE_LIMIT_MAX`, `ALERT_COOLDOWN_MS`,
      `ALERT_RESOLVE_AFTER_MS`).

## 0.3 Definir identificadores estables

- [ ] Añadir `INVESTIGATION_RUN_SCHEMA`,
      `INVESTIGATION_VERSION_SCHEMA`, `INVESTIGATION_FEEDBACK_SCHEMA`
      a `packages/shared/src/contracts.ts`.
- [ ] Definir los tres Zod envelopes (`investigationRunSchema`,
      `investigationVersionSchema`, `investigationFeedbackSchema`)
      con `.strict()` y shape opaco ASCII para los IDs.
- [ ] Tests RED → verde en
      `packages/shared/tests/contracts-investigation.test.ts`.

## 0.4 Política de conservación, redacción y acceso

- [ ] Crear `docs/security/retention-and-redaction.md` con: conservación
      (rollback = flag OFF, no DELETE), redacción (logs externos y
      respuestas LLM no son instrucciones), acceso (referencias
      `redacted` muestran "no disponible", no inventan), multi-tenant
      (validación server-side, ningún tenantId del navegador concede
      acceso), rollback por desactivación (rutas devuelven 404/501,
      cola drenada), datos de demo (no entran en precisión de campo).

## 0.5 Crear fixtures de incidentes

- [ ] Definir 25 IDs opacos + 3 timestamps en
      `packages/evidence/tests/fixtures/incident-investigation.ts`:
      `tenant-primary`, `tenant-neighbor`, dos conexiones, dos OLTs,
      PON, splitter, CTO, ONUs para cada escenario (individual,
      compartida A/B, contradicción, sin topología, vecino) y
      `incident-*` para cada uno.
- [ ] Tests RED → verde en
      `packages/evidence/tests/fixtures/incident-investigation.test.ts`.

## 0.6 Reconciliar openspec/config.yaml

- [ ] Reemplazar 13 ocurrencias de `lint: "echo \"no lint configured\""`
      por `lint: "eslint ."`. Verificar 0 residuos.

## Gate 0 — Cierre

- [ ] `pnpm --filter @ftth-copilot/shared test` verde.
- [ ] `pnpm --filter @ftth-copilot/evidence test` verde.
- [ ] `pnpm typecheck` (turbo) verde.
- [ ] `pnpm lint` (turbo) verde.
- [ ] `openspec/config.yaml` sin `echo "no lint configured"` literales.
- [ ] Documentos de evidencia firmados en `docs/validation/`.

## Rollback

- Revertir el commit de esta fase. Los cambios son aditivos (no
  tocan tablas, no cambian APIs existentes). El rollback es seguro
  incluso post-merge.
