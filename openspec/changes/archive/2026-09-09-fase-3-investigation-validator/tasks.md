# Tareas — Fase 3 PR #4: Server-side investigation reference & temporal validator

## 3.4.1 Tipos e interfaces del validador

- [x] Definir `ValidationIssue`, `ValidationIssueCode`, `InvestigationValidationReport` en `packages/agent-core/src/investigation-validator.ts`.
- [x] Códigos de problema: `cross_tenant_evidence`, `out_of_window_evidence`, `hallucinated_reference`, `numerical_contradiction`, `malformed_structure`.

## 3.4.2 Implementación de validación del lado servidor

- [x] Implementar `validateInvestigationResult(result, context)`:
  - Verificación de pertenencia estricta a `tenantId`.
  - Verificación de timestamps dentro de `[windowStart, windowEnd]`.
  - Verificación de que cada `forRefIds` y `againstRefIds` exista en `evidenceRefs`.
  - Detección de contradicciones numéricas entre métricas citadas y resúmenes de hipótesis.
  - Saneamiento y producción de `sanitizedResult` conforme al esquema `ftth.investigation-result.v1`.

## 3.4.3 Generación de fallback seguro

- [x] Implementar `buildSafeFallbackResult(args)` para devolver un sobre garantizado cuando el payload sea inválido o corrupto, con observaciones faltantes explícitas.

## 3.4.4 Exportación y Barrel

- [x] Re-exportar validador, tipos y fallback en `packages/agent-core/src/index.ts`.

## 3.4.5 Pruebas unitarias TDD

- [x] Crear `packages/agent-core/tests/investigation-validator.test.ts` cubriendo:
  - Resultado válido sin problemas.
  - Purgado de referencias ajenas al tenant.
  - Detección y corrección de referencias fuera de ventana.
  - Detección de referencias alucinadas en hipótesis y contradicciones.
  - Detección de discrepancias numéricas en hipótesis.
  - Fallback seguro ante estructuras corruptas o no parseables.

## 3.4.6 Verificación y CI

- [x] Ejecutar `pnpm turbo run build lint test` y confirmar 100% verde en local.
