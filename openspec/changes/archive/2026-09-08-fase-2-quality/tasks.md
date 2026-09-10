# Tareas — Fase 2 PR #1: Evidence Quality Primitives

## 2.1 Primitivas Puras de Calidad
- [x] Implementar funciones puras de evaluación de telemetría en `packages/evidence/src/quality.ts`:
  - Frescura y cálculo de cadencia esperada.
  - Tolerancia a huecos temporales internos (gaps).
  - Detección de contadores reiniciados y discontinuidades.
- [x] Distinguir explícitamente falla del dispositivo de falla del recolector.

## 2.2 Pruebas Unitarias
- [x] Crear `packages/evidence/tests/quality.test.ts` con casos límite (0 muestras, 1 muestra, hueco prolongado, timestamp en el futuro).
