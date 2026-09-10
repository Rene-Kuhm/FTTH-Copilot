# Fase 7 — Pilot and Acceptance (Piloto y Aceptación)

## Why

Roadmap Fase 7 (7.1 a 7.7 + Gate 7):
- 7.1: Elegir un tenant piloto autorizado y habilitar funciones de forma progresiva. Mantener procedimiento operativo manual de respaldo.
- 7.2: Congelar conjunto de evaluación separado de desarrollo y registrar versión del modelo, prompt, reglas, fuentes y configuración por ejecución.
- 7.3: Medir diagnóstico correcto entre casos evaluables, afirmaciones respaldadas, abstención, cobertura de etiquetas, falsos positivos de alertas, latencia p95 y costo por investigación. No confundir clasificación de evidencia con corrección de causa raíz.
- 7.4: Registrar tiempo hasta causa confirmada y hasta resolución como métricas distintas; comparar contra baseline de incidentes comparables y reportar tamaño de muestra.
- 7.5: Definir antes del piloto los umbrales numéricos de aceptación y duración. Si no están fijados, no habilitar producción general. Propuesta de inicio: 14 días y 50 investigaciones adjudicadas, ampliando el período si no se alcanza el volumen; esto no garantiza suficiencia estadística.
- 7.6: Criterios duros: cero accesos cruzados, cero acciones NMS no autorizadas y rechazo de referencias inexistentes en pruebas de aceptación. Reportar incertidumbre de las métricas de campo.
- 7.7: Probar rollback y recuperación; decidir continuar piloto, corregir o lanzar, con evidencia escrita.
- Gate 7: Reporte reproducible, limitaciones explícitas, umbrales satisfechos y procedimiento operativo disponible.

## What changes

1. **Pilot Provisioning & SOP (7.1)**:
   - Define pilot authorization and progressive feature enablement contract (`pilotTenantConfigSchema`) in `@ftth-copilot/eval` / `@ftth-copilot/shared`.
   - Create standard operating backup procedure in `docs/operations/pilot-sop-and-fallback.md`.
2. **Frozen Evaluation Dataset & Execution Traceability (7.2)**:
   - Provide frozen held-out evaluation dataset in `packages/eval/src/pilot-frozen-dataset.ts` (`ftth.pilot-frozen-eval.v1`), strictly separate from development examples.
   - Enforce execution provenance recording: `modelVersion`, `promptVersion`, `rulesVersion`, `sources`, `runtimeConfig`.
3. **Pilot Evaluation & Metrics Engine (7.3, 7.4)**:
   - Implement `packages/eval/src/pilot-metrics.ts` computing:
     - Diagnostic accuracy over evaluable cases.
     - Supported claims ratio.
     - Abstention rate.
     - Label coverage.
     - Alert false positive rate.
     - p95 investigation latency.
     - Estimated cost per investigation.
     - Separate time-to-confirmed-cause vs time-to-resolution, sample sizes, and comparison to baseline.
4. **Numerical Acceptance Thresholds & Hard Safety Gates (7.5, 7.6)**:
   - Implement `packages/eval/src/pilot-acceptance.ts`:
     - Hard safety criteria validator: 0 cross-tenant accesses, 0 unauthorized NMS actions, rejection of non-existent entity references.
     - Threshold evaluator: 14-day duration, >=50 adjudicated cases, accuracy, claims, and latency bounds.
5. **Rollback Verification & Gate 7 Report (7.7, Gate 7)**:
   - Unit and integration tests verifying flag-off rollback behavior (retaining data per retention policy without side-effects).
   - Gate 7 validation report template and evidence in `docs/validation/fase-7-pilot-report.md`.
