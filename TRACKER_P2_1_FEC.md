# Tracker: P2.1 FEC Collection & Operational Roadmap

Estado del ciclo de entrega para la recolección de Forward Error Correction (FEC) y continuidad operativa.

## Estado de Entrega P2.1 (Completado)

- [x] **PR 1: `feat/p2-1-fec-helpers` (helpers-slice)**: Helpers de extracción, cálculo de tasas de error corregibles/incorregibles y evaluación de umbrales ópticos. *(Completado y mergeado en main)*.
- [x] **PR 2: `feat/p2-1-fec-scheduler` (scheduler-slice)**: Scheduler de recolección periódica, fan-out por ciclo, respeto de rate limits y persistencia de métricas. *(Completado y mergeado en main)*.

Ambos slices fueron integrados y validados en `main` bajo CI estricto.

---

## Roadmap de Saneamiento e Integración Operativa

1. **PR 1 — Documentación y Contratos (En progreso)**:
   - Sincronización de enlaces de fuentes OLT (`research/olt/`).
   - Declaración de `METRICS_BEARER_TOKEN` en `.env.example` y documentación de `/api/metrics` (Prometheus).
   - Documentación y sinceramiento de estado: Integrado en runtime vs Disponible como paquete vs Pendiente/Bloqueado.
   - Aclaración formal de la matriz OLT (12 fabricantes PEN IANA + 2 interfaces estándar).

2. **PR 2 — Integración Operativa MikroTik, Slack y WhatsApp (Siguiente)**:
   - Exposición de conector MikroTik RouterOS v7 en `/api/connectors` y UI de configuración.
   - Persistencia cifrada en PostgreSQL (AES-256-GCM derivado de KMS).
   - Test de conexión y health check para RouterOS.
   - Integración de despachadores Slack (Block Kit) y WhatsApp (gateways) al flujo real de alertas por tenant en Next.js.
   - Tests de integración end-to-end para el flujo de alertas y conectores.

3. **PR 3 — Observabilidad LLM con Phoenix (Roadmap)**:
   - Instrumentación de inferencia y agentes cognitivos con OpenInference / OpenTelemetry.
   - Captura de spans de RAG, hipótesis de causa raíz y herramientas.
   - Métricas de latencia, tokens, errores y fallback de proveedores.
   - Endpoint configurable `PHOENIX_COLLECTOR_ENDPOINT` y redacción estricta de secretos.
