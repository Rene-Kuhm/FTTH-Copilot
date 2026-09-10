# Tareas — Fase 3 PR #2: Cognitive investigation evidence collector

## 3.2.1 Especificación y tipos del recolector

- [x] Definir interfaces de entrada en `packages/evidence/src/evidence-collector.ts`:
  - `CollectEvidenceArgs`: `tenantId`, `deviceId`, `connectionId?`, `incidentId?`, `windowStart`, `windowEnd`, `cutoffAt?`, y colecciones crudas opcionales (`metrics`, `events`, `topologyHops`, `confirmedIncidents`, `feedbacks`).
  - Validación de tenant (`MissingTenantError`) y de ventana temporal (`MAX_INVESTIGATION_WINDOW_DAYS`).

## 3.2.2 Lógica de recolección determinista

- [x] Métricas: mapear `MetricSample` a `InvestigationEvidenceRef` con `kind: 'metric'` y evaluar calidad mediante `evidence-quality`.
- [x] Eventos: mapear `DeviceEvent` a `InvestigationEvidenceRef` con `kind: 'event'`.
- [x] Topología: mapear `TopologyHop` a `InvestigationEvidenceRef` con `kind: 'topology'`.
- [x] Historial confirmado: mapear `ConfirmedIncident` a `InvestigationEvidenceRef` con `kind: 'incident_history'`, delimitado con prefijo `[Contexto Histórico]`.
- [x] Feedback previo: mapear adjudicaciones previas a `InvestigationEvidenceRef` con `kind: 'feedback'`.
- [x] Ordenamiento determinista (fecha descendente, kind, id) y acotación a `MAX_INVESTIGATION_EVIDENCE_REFS` (64).

## 3.2.3 Exportación y Barrel

- [x] Re-exportar `collectInvestigationEvidence`, tipos asociados y errores en `packages/evidence/src/index.ts`.

## 3.2.4 Pruebas unitarias TDD

- [x] Crear `packages/evidence/tests/evidence-collector.test.ts` cubriendo:
  - Happy path completo con los 5 kinds de evidencia.
  - Aislamiento multi-tenant (descarte de datos de otro tenant y excepción si tenant está vacío).
  - Filtrado estricto por ventana temporal [windowStart, windowEnd].
  - Demarcación explícita de contexto en historial confirmado.
  - Límite máximo de 64 referencias respetado ante sobrecarga de muestras.
  - Determinismo en el ordenamiento.
  - Validación de esquema con `investigationEvidenceRefSchema.parse`.

## 3.2.5 Verificación y CI

- [x] Ejecutar `pnpm turbo run build lint test` y confirmar 100% verde sin regresiones.

