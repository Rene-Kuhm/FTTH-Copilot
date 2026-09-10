# Tareas — Fase 1 PR #5: Investigation Feedback Export to packages/eval

## 1.5.1 Exportación de Feedback
- [x] Implementar `packages/eval/src/feedback-export.ts`:
  - `toInvestigationFeedbackExport`: mapeo al envelope `ftth.investigation-feedback-export.v1`.
  - `computeFeedbackSummary`: cálculo de precisión respetando la regla "si faltan etiquetas, mostrar insuficiencia sin inventar precisión".
- [x] Exportar tipos y funciones desde `packages/eval/src/index.ts`.

## 1.5.2 Pruebas Unitarias
- [x] Crear `packages/eval/tests/feedback-export.test.ts`.
- [x] Probar exportación individual, en lote y agregación con muestras incompletas.
