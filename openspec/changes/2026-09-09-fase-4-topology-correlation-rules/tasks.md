# Tareas — Fase 4 PR #1: Deterministic Topology and Time Correlation Rules (Fase 4.1)

## 4.1.1 Contratos y Esquemas en `@ftth-copilot/shared`

- [x] Definir esquemas y tipos en `packages/shared/src/contracts.ts`:
  - `topologyCorrelationEventSchema`: evento/incidente de entrada con timestamp, deviceId, deviceKind, tenantId.
  - `topologyCorrelationConfigSchema`: configuración calibrable (`timeWindowMs`, `minAffectedCount`, `minAffectedRatio`, `targetAncestorKinds`).
  - `topologyCorrelationGroupSchema`: grupo correlacionado resultante con ancestro, conteos, proporción y dispositivos afectados y sanos.

## 4.1.2 Fixtures Calibrables de Topología y Eventos

- [x] Crear `packages/evidence/tests/fixtures/topology-correlation-fixtures.ts`:
  - Topología estándar con jerarquía OLT -> PON_PORT -> SPLITTER -> CTO -> ONU.
  - Fixtures de casos de prueba:
    - Caída masiva en CTO (todas las ONUs de la CTO afectadas en ventana corta).
    - Caída aislada (1 sola ONU).
    - Caída en Splitter (afectando múltiples CTOs hijas).
    - Fallos independientes dispersos en el puerto PON (por debajo del umbral de proporción).
    - Fallos dispersos en el tiempo (fuera de la ventana temporal).
    - Datos multi-tenant con identificadores colisionantes.

## 4.1.3 Pruebas Unitarias TDD (RED)

- [x] Crear `packages/evidence/tests/topology-correlation.test.ts`:
  - Prueba de agrupación a nivel CTO por ancestro compartido y proximidad temporal.
  - Prueba de rechazo cuando no se alcanza `minAffectedCount`.
  - Prueba de agrupación a nivel Splitter cuando afecta múltiples CTOs.
  - Prueba de rechazo cuando no se alcanza `minAffectedRatio` a nivel PON.
  - Prueba de partición temporal por `timeWindowMs`.
  - Prueba de aislamiento estricto multi-tenant.
  - Prueba de determinismo de salida (mismo input produce el mismo orden y contenido).

## 4.1.4 Implementación del Motor de Reglas en `@ftth-copilot/evidence`

- [x] Implementar `packages/evidence/src/topology-correlation.ts`:
  - `correlateByTopologyAndTime(events, edges, config)`.
  - Filtrado y aislamiento por tenant.
  - Ventana temporal determinista.
  - Evaluación de ancestros jerárquicos usando `bfsAncestors` y `bfsDownstream`.
  - Selección del ancestro más específico que cumpla umbrales.
  - Cálculo de población observada y dispositivos sanos.
- [x] Exportar desde `packages/evidence/src/index.ts`.

## 4.1.5 Verificación y Calidad

- [x] Ejecutar suites de tests y confirmar 100% verde (GREEN).
- [x] Ejecutar `pnpm turbo run build lint test` en todo el monorepo.
