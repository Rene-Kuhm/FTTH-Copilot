# Tareas — Fase 2 PR #3: Per-Connection Scheduler Health + Hung-Loop Detection

## 2.3.1 Salud del Scheduler por Conexión
- [x] Extender `apps/web/lib/monitoring/scheduler-health.ts` para registrar métricas de salud por conexión y OLT.
- [x] Implementar detección de ciclos colgados (hung-loop) y reportar estado en `/api/health`.
- [x] Tests en `apps/web/tests/lib/monitoring/scheduler-health.test.ts`.
