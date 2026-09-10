# Tareas — Fase 1 PR #3: Optional Feedback Link on ConfirmedIncident

## 1.3.1 Relación No Destructiva
- [x] Vincular `ConfirmedIncident` con `investigationFeedbackId` opcional sin obligar a promover incidentes abiertos.
- [x] Garantizar que el feedback negativo (`incorrect`) jamás promueva automáticamente el incidente.
- [x] Tests en `packages/db/tests/investigation-feedback-no-promote.test.ts`.
