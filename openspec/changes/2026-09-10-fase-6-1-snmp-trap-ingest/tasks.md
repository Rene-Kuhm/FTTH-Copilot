# Tareas — Fase 6 PR #1: SNMP Trap Ingestion Catalog, Parser & Normalizer

## 6.1.1 Catálogo Canónico de Traps (6.1)
- [x] Implementar `packages/monitoring/src/snmp/catalog.ts`:
  - Definiciones de OIDs estándar (LinkDown, LinkUp, warmStart, coldStart).
  - OIDs de vendor GPON (Huawei SmartAX, ZTE, ITU-T).
  - Categorías canónicas: `dying_gasp`, `los`, `link_down`, `link_up`, `restart`, `unknown_trap`.
- [x] Tests de catálogo en `packages/monitoring/tests/snmp/catalog.test.ts`.

## 6.1.2 Registro y Aislamiento de Remitentes (6.2)
- [x] Implementar `packages/monitoring/src/snmp/mapping.ts`:
  - `resolveTrapSender(senderIp, registry)`
  - Blindaje: nunca confiar en tenant en el payload.
- [x] Tests de mapeo y aislamiento en `packages/monitoring/tests/snmp/mapping.test.ts`.

## 6.1.3 Parser y Normalizador a telemetry.v1 (6.3, 6.4)
- [x] Implementar `packages/monitoring/src/snmp/parser.ts`:
  - Parser de varbinds / trap packets (v1 / v2c).
  - Normalizador a `TelemetryEvent` con `source: 'snmp-trap'`.
  - Tratamiento seguro de OIDs desconocidos sin invención de diagnóstico.
- [x] Tests de parsing y normalización en `packages/monitoring/tests/snmp/parser.test.ts`.

## 6.1.4 Ingestion Guard: Tasa, Límites y Deduplicación (6.5)
- [x] Implementar `packages/monitoring/src/snmp/guard.ts`:
  - Control de tasa (RateWindowCounter), límite de tamaño y ventana de deduplicación.
- [x] Tests de guard en `packages/monitoring/tests/snmp/guard.test.ts`.

## 6.1.5 Receptor UDP y Exportaciones Monorepo
- [x] Exportar desde `packages/monitoring/src/index.ts`.
- [x] Implementar receptor UDP configurable en `apps/web/lib/monitoring/snmp.ts` (desactivado por defecto).
- [x] Tests de integración del receptor en `apps/web/tests/lib/monitoring/snmp.test.ts`.

## 6.1.6 Verificación de Calidad
- [x] Ejecutar suites de tests de `@ftth-copilot/monitoring` y `@ftth-copilot/web`.
- [x] Ejecutar `pnpm turbo run build lint test` en todo el monorepo.
