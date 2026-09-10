# Tareas — Fase 3 PR #7: Cognitive Investigation Card & Human Feedback UI

## 3.7.1 Contratos de UI y Constantes

- [x] Definir constantes y etiquetas bloqueadas en español para la ficha de investigación:
  - Estados de suficiencia: `Suficiente`, `Provisional`, `Insuficiente`.
  - Estados de soporte de hipótesis: `Respaldada`, `Contradicha`, `Mixta`, `No verificada`.
  - Kinds de comprobaciones de solo lectura: `Observación directa`, `Consulta de topología`, `Eventos recientes`, `Historial de métricas`.
  - Calidades de evidencia: `Vigente`, `Vencida`, `Insuficiente`, `Desconocida`, `Error`.

## 3.7.2 Pruebas Unitarias TDD (RED)

- [x] Crear `apps/web/tests/components/investigation-card.test.ts`:
  - Pruebas de mapeo de etiquetas y clases para suficiencia y soporte de hipótesis.
  - Comprobación de que no se calculan ni renderizan porcentajes de confianza.
  - Validación de que los kinds de comprobaciones son estrictamente de solo lectura.
  - Validación de la estructura de solicitud de re-investigación (`refresh: true`).
  - Validación de la vinculación del feedback con `versionId` inmutable.

## 3.7.3 Implementación de Ficha `InvestigationCard`

- [x] Crear `apps/web/components/InvestigationCard.tsx`:
  - Fetch inicial (`GET /api/incidents/[id]/investigate`).
  - Disparador de investigación inicial o "Reinvestigar" (`POST` con `{ refresh: true }`).
  - Manejo de respuesta 202 `pending` con reintento/polling.
  - Renderizado del encabezado y suficiencia con `sufficiencyReason`.
  - Renderizado de hipótesis con `supportLevel` y desglose de referencias a favor (`forRefIds`) y en contra (`againstRefIds`).
  - Catálogo de referencias de evidencia con `kind`, `quality`, `source`, fecha y resumen.
  - Sección de contradicciones y observaciones faltantes (`missing`).
  - Comprobaciones sugeridas de solo lectura.
  - Integración de feedback de técnico (adjudicación con `runId` y `versionId`).

## 3.7.4 Integración en `IncidentsPanel`

- [x] Integrar `InvestigationCard` en `apps/web/components/IncidentsPanel.tsx`:
  - Permitir a operadores expandir/cerrar la ficha de investigación para cada incidente.

## 3.7.5 Verificación y Calidad

- [x] Ejecutar `pnpm turbo run test` y verificar que todos los tests pasen (GREEN).
- [x] Ejecutar `pnpm turbo run build lint test` en todo el monorepo.
