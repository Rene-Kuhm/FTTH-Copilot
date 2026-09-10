# Tareas — Fase 3 PR #1: Investigation Result Contract

## 3.1.1 Contrato Formal ftth.investigation-result.v1
- [x] Especificar `investigationResultSchema` en `packages/shared/src/contracts.ts` con Zod strict.
- [x] Modelar hipótesis con niveles explicables de soporte (`supported`, `contradicted`, `mixed`, `unverified`) sin confianza numérica no calibrada.
- [x] Fijar límites máximos (64 evidencias, 8 hipótesis, 16 contradicciones, 16 faltantes, 8 comprobaciones, 30 días de ventana).
- [x] Tests unitarios en `packages/shared/tests/contracts-investigation.test.ts`.
