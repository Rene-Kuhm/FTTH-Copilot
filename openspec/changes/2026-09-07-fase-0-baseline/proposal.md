# Fase 0 — Baseline, contratos de identidad y fixtures

## Why

La función **Investigar incidente** (ver `docs/roadmap-investigacion-cognitiva.md`)
introduce tres superficies nuevas: una corrida (`InvestigationRun`), una
versión inmutable de diagnóstico (`InvestigationVersion`) y un feedback
del técnico (`InvestigationFeedback`). Ninguna fase posterior puede
arrancar sin identificadores estables, sin un baseline reproducible y
sin fixtures que codifiquen los escenarios del roadmap. Esta fase
define la base sobre la que se construyen las fases 1–7 sin reescribir
contratos y sin duplicar tablas.

## What changes

- `docs/roadmap-investigacion-cognitiva.md`: el roadmap completo,
  copia firmada del input del usuario. Es la **fuente de verdad** del
  orden de fases y reglas de implementación.
- `docs/validation/fase-0-baseline.md`: registro del SHA base, comandos
  reales de CI, inventario de superficies reutilizadas, evidencia del
  estado gate 0.
- `docs/security/retention-and-redaction.md`: política de conservación,
  redacción y acceso a evidencia para todas las fases. Cubre rollback
  por flag, multi-tenant, datos no confiables y datos de demo.
- `packages/shared/src/contracts.ts`: tres Zod schemas nuevos
  (`investigationRunSchema`, `investigationVersionSchema`,
  `investigationFeedbackSchema`) con sus versiones de esquema
  (`ftth.investigation-run.v1`, etc.). **No** agregan campos de payload
  más allá de los identificadores; las fases 1 y 3 los extienden.
- `packages/shared/tests/contracts-investigation.test.ts`: 19 tests
  RED → verde que pinean el contrato (versiones, shape, drift
  detector, namespaces disjuntos, opaco ASCII).
- `packages/evidence/tests/fixtures/incident-investigation.ts`: 25
  identificadores opacos + 3 timestamps + ventana de 30 días, usados
  como fixtures compartidos por fases 1, 3 y 5.
- `packages/evidence/tests/fixtures/incident-investigation.test.ts`: 6
  tests RED → verde que pinean la consistencia de los fixtures.
- `openspec/config.yaml`: `lint` actualizado de
  `"echo \"no lint configured\""` a `eslint .` para los 13 paquetes no-web.
  Es la reconciliación que el roadmap señala como fase 0.6.

## Impact

- Cero migraciones. Cero cambios a tablas existentes.
- Cero endpoints nuevos. Cero UI nueva. Cero llamadas LLM/NMS.
- Los identificadores quedan disponibles para que las fases siguientes
  los adopten sin redefinir nombres ni versiones.
- El repo ahora tiene un único documento canónico
  (`docs/roadmap-investigacion-cognitiva.md`) que coordina las fases
  pendientes; cualquier cambio de orden se hace contra este documento.

## Out of scope

- Persistencia de `InvestigationRun` / `InvestigationVersion` /
  `InvestigationFeedback`. Entra en fase 1 (PRs separados).
- Endpoints de investigación. Entra en fase 3.
- Validación humana y etiquetas. Entra en fase 1.
- Calidad de telemetría. Entra en fase 2.
- Cualquier cambio a la lógica existente de `Incident`,
  `ConfirmedIncident`, `PendingIncidentCandidate`,
  `apps/web/app/api/incidents/*`. Esta fase **no toca** esas rutas.
