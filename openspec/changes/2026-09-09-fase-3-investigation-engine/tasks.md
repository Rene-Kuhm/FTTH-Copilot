# Tareas — Fase 3 PR #3: Cognitive investigation engine & deterministic facts

## 3.3.1 Extracción de hechos deterministas

- [x] Crear `packages/agent-core/src/investigation-facts.ts`:
  - Definir tipos de hechos: `InvestigationFacts`, `OpticalFacts`, `EventFacts`, `TopologyFacts`.
  - Implementar función pura `computeInvestigationFacts(evidenceRefs)`.
  - Calcular degradación óptica (mínimo, máximo, delta, umbrales de atenuación).
  - Calcular agregados de eventos (conteos de dying-gasp, los, link-down, cortes de energía vs fibra).
  - Extraer ancestros compartidos de topología y contexto histórico de incidentes previos.
  - Generar observaciones faltantes deterministas si métricas o eventos esenciales están ausentes.

## 3.3.2 Prompting cognitivo y contrato estructurado

- [x] Crear `packages/agent-core/src/investigation-prompt.ts`:
  - Formatear hechos deterministas y catálogo acotado de referencias de evidencia (`evidenceRefId`).
  - Instrucciones estrictas de sistema para generar hipótesis trazables, contradicciones, faltantes y comprobaciones de solo lectura.
  - Parser robusto de JSON LLM con recuperación ante bloques markdown (```json ... ```).

## 3.3.3 Motor de investigación y saneamiento de citas

- [x] Crear `packages/agent-core/src/investigation-engine.ts`:
  - Implementar `investigateIncident(args: InvestigationEngineArgs): Promise<InvestigationResult>`.
  - Validación de ventana temporal (≤30 días, windowStart <= windowEnd).
  - Cómputo de hechos deterministas.
  - Invocación de `LlmClient` con fallback determinista ante fallas/timeouts/JSON inválido.
  - Saneamiento de citas: poda estricta de `forRefIds` y `againstRefIds` que no existan en la evidencia de entrada.
  - Sanitización de comprobaciones: asegurar que `kind` sea exclusivamente uno de los read-only permitidos (`observe_only`, `topology_lookup`, `recent_events`, `metric_history`).
  - Validación final mediante `investigationResultSchema.parse`.

## 3.3.4 Exportaciones e integración en barrel

- [x] Exportar `investigateIncident`, `computeInvestigationFacts`, tipos y constantes en `packages/agent-core/src/index.ts`.

## 3.3.5 Pruebas unitarias y TDD

- [x] Crear `packages/agent-core/tests/investigation-facts.test.ts` para cálculos deterministas puros.
- [x] Crear `packages/agent-core/tests/investigation-engine.test.ts` cubriendo:
  - Generación de hipótesis con citas válidas.
  - Poda de citas alucinadas.
  - Manejo de checks inválidos (no-reboot).
  - Fallback determinista ante error de LLM o respuesta vacía/inválida.
  - Validación de ventana temporal y bounds de listas.

## 3.3.6 Verificación y CI

- [x] Ejecutar `pnpm turbo run build lint test` y confirmar 100% verde en local.
