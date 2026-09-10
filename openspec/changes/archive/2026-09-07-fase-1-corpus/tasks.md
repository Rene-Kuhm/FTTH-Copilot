# Tareas — Fase 1 PR #6: Frozen Investigation Feedback Corpus

## 1.6.1 Corpus Calibration Dataset
- [x] Implementar dataset estático `INVESTIGATION_CORPUS` en `packages/eval/tests/fixtures/investigation-corpus.ts` con schema `ftth.investigation-corpus.v1`.
- [x] Cumplir piso mínimo del spec: >= 30 casos totales (al menos 5 confirmed, 5 incorrect, 5 insufficient_data).
- [x] Validar desacuerdos y resolución documentada por adjudicador.

## 1.6.2 Suite de Pruebas
- [x] Crear `packages/eval/tests/investigation-corpus.test.ts`.
- [x] Verificar invariantes del corpus congelado (inmutabilidad, unicidad de IDs y validación de etiquetas).
