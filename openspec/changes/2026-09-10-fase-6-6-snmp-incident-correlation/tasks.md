# Tareas — Fase 6 PR #2: SNMP Trap and Incident Correlation + Recovery Linking

## 6.6.1 Lógica de Correlación y Recuperación (6.6)
- [x] Implementar `packages/monitoring/src/snmp/incident-linker.ts`:
  - `correlateTrapWithIncidents(args)`
  - Detección de alarma vs recuperación (`link_up`).
  - Protección contra desorden UDP / timestamps retrasados.
  - Aislamiento multi-tenant.
- [x] Tests unitarios TDD en `packages/monitoring/tests/snmp/incident-linker.test.ts`.

## 6.6.2 Exportaciones y Monorepo
- [x] Re-exportar desde `packages/monitoring/src/index.ts`.
- [x] Ejecutar tests de `@ftth-copilot/monitoring`.
- [x] Ejecutar `pnpm turbo run build lint test` en todo el monorepo.
