# ADR-042: Laya como Fast Decision Layer (System 1)

**Estado:** Propuesto\
**Fecha:** 2026-09-27\
**Decisores:** equipo FTTH-Copilot\
**Proyecto:** FTTH-Copilot

---

## Contexto

FTTH-Copilot posee un **Organic Diagnostic Router** (`adaptive-router.ts`) que selecciona entre `direct`, `assisted` e `investigation` basándose en señales de la query del operador. Este router es determinista y rule-based.

El documento de diseño propone incorporar **Laya** como una capa de decisión no autoregresiva que clasifique eventos de red (alarmas, métricas) antes de invocar el pipeline generativo.

### Arquitectura existente

```
operator query → adaptive-router (direct|assisted|investigation) → tools → agent-core → LLM
```

### Propuesta de integración

```
evento normalizado → Laya (System 1) → adaptive-router (existente)
                                           ↓
                                   direct | assisted | investigation
```

Laya NO reemplaza el adaptive-router. Solo provee una señal adicional al clasificar eventos de telemetría/alarma.

---

## Decisiones

### DEC-042-1: Topología inicial — módulo importable, no microservicio

**Decisión:** Implementar Laya como módulo TypeScript/Python ejecutable en el mismo proceso Node.js, usando ONNX Runtime. Promover a microservicio solo si se justifica por GPU dedicado o múltiples clientes.

**Alternativa descartada:** Microservicio Docker Python desde el día uno.

**Rationale:**
- El documento propone microservicio por "desacoplamiento", pero FTTH-Copilot es un monorepo pnpm donde desacoplar significa agregar latencia HTTP interna, network Docker, autenticación interna, y circuit breaker antes de validar valor.
- ONNX Runtime funciona en Node.js (`onnxruntime-node`).
- Si Laya funciona bien y justifica GPU o múltiples clientes, la migración a microservicio es trivial.

**Posición futura:** Si después de shadow + assisted mode se justifica un servicio separado, se crea `services/laya/` con Dockerfile propio.

### DEC-042-2: Feature flags iniciales

```env
# Master switch — apagado por defecto hasta validar
LAYA_ENABLED=false

# Modos: disabled | shadow | assisted
LAYA_MODE=shadow

# URL (ignorado si se usa módulo importable)
LAYA_URL=http://laya:8080

# Timeout en ms
LAYA_TIMEOUT_MS=250

# Fail-open: si Laya falla, usar pipeline actual
LAYA_FAIL_OPEN=true

# Calibración inicial (valores de ejemplo, ajustar con datos)
LAYA_CONFIDENCE_THRESHOLD_HIGH=0.95
LAYA_CONFIDENCE_THRESHOLD_LOW=0.75

# checkpoint
LAYA_MODEL=laya-multilingual
LAYA_MODEL_VERSION=pinned
```

**Kill switch:** `LAYA_ENABLED=false` revierte todo sin redeploy.

### DEC-042-3: Contratos entrada/salida

#### Contrato de entrada (DecisionEvent)

```typescript
// Ubicación: packages/shared/src/contracts.ts
export const LAYA_DECISION_EVENT_SCHEMA = 'ftth.laya-decision-event.v1' as const;

export const layaDecisionEventSchema = z.object({
  schema: z.literal(LAYA_DECISION_EVENT_SCHEMA),
  eventId: z.string().min(1),
  tenantId: z.string().min(1),
  timestamp: z.string().datetime(),
  source: z.enum(['smartolt', 'mikrowisp', 'snmp', 'syslog', 'routeros', 'synthetic']),
  vendor: z.string().optional(),
  deviceKind: z.enum(['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU', 'ROUTER']).optional(),
  deviceId: z.string().optional(),
  alarmType: z.string().optional(),
  rxPower: z.number().optional(),
  rxTrend: z.number().optional(),
  affectedOnus: z.number().int().nonnegative().optional(),
  dyingGasp: z.boolean().optional(),
  powerAlarm: z.boolean().optional(),
  rawSummary: z.string(),
  // topología — solo IDs, nunca secretos
  topologyContext: z.object({
    oltId: z.string().optional(),
    ponPort: z.string().optional(),
    splitterId: z.string().optional(),
    ctoId: z.string().optional(),
  }).optional(),
}).strict();
```

**Regla:** No enviar tokens, credenciales NMS, ni información innecesaria.

#### Contrato de salida (LayaDecision)

```typescript
// Ubicación: packages/shared/src/contracts.ts
export const LAYA_DECISION_SCHEMA = 'ftth.laya-decision.v1' as const;

export const eventClassSchema = z.enum([
  'NORMAL',
  'OPTICAL_DEGRADATION',
  'OPTICAL_FAULT',
  'POWER_FAULT',
  'DEVICE_FAULT',
  'UPLINK_FAULT',
  'CONGESTION',
  'MASS_OUTAGE',
  'SECURITY_EVENT',
  'UNKNOWN',
]);

export const severityLevelSchema = z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const probableScopeSchema = z.enum([
  'ONU', 'CTO', 'SPLITTER', 'PON', 'OLT', 'UPLINK', 'POWER', 'UNKNOWN',
]);

export const suggestedRouteSchema = z.enum(['DIRECT', 'ASSISTED', 'INVESTIGATION']);

export const layaDecisionSchema = z.object({
  schema: z.literal(LAYA_DECISION_SCHEMA),
  eventId: z.string().min(1),
  eventClass: eventClassSchema,
  severity: severityLevelSchema,
  probableScope: probableScopeSchema,
  suggestedRoute: suggestedRouteSchema,
  requiresInvestigation: z.boolean(),
  confidence: z.object({
    eventClass: z.number().min(0).max(1),
    severity: z.number().min(0).max(1),
    probableScope: z.number().min(0).max(1),
    suggestedRoute: z.number().min(0).max(1),
  }),
  model: z.string(),
  modelVersion: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
}).strict();
```

**Regla:** No texto libre de Laya como explicación de causa raíz. Salida tipada, no generativa.

### DEC-042-4: Criterios numéricos para promoción shadow → assisted

Antes de pasar de `shadow` a `assisted`, deben cumplirse TODOS estos umbrales medidos con dataset FTTH real o sintético validado:

| Métrica | Umbral | Notas |
|---------|--------|-------|
| Precision por clase (promedio) | >= 0.85 | Por cada `eventClass` |
| Recall por clase (promedio) | >= 0.80 | Por cada `eventClass` |
| F1 por clase (promedio) | >= 0.82 | Media armónica de precision/recall |
| Calibration error (ECE) | <= 0.05 | Expected Calibration Error |
| FPR para MASS_OUTAGE | <= 0.05 | False Positive Rate para eventos masivos |
| FPR para POWER_FAULT | <= 0.03 | False Positive Rate para fallas de energía |
| Acuerdo con adaptive-router | >= 0.70 | % de casos donde suggestedRoute coincide |
| Latencia p95 | <= 200ms | Percentil 95 de latencia de respuesta |

**Excepciones obligatorias:**
- `UNKNOWN` con confidence < 0.75 → siempre escalar a `INVESTIGATION`
- `CRITICAL` con confidence < 0.90 → siempre escalar a `INVESTIGATION`
- Cualquier señal contradictoria → siempre escalar a `INVESTIGATION`

**No se promueve si:**
- El dataset de evaluación tiene menos de 500 escenarios
- Los tests de negación fallan (e.g., "ONU NO presenta LOS" clasificado como OPTICAL_FAULT)
- Hay clases con F1 < 0.70 (alto riesgo de mala clasificación)

---

## Implementación

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `packages/shared/src/contracts.ts` | Contratos `LayaDecisionEvent`, `LayaDecision`, `LayaConfig` |
| `packages/shared/src/laya-client.ts` | Cliente TypeScript con timeout, circuit breaker, fallback |
| `packages/shared/src/laya-integration.ts` | Integración con adaptive router |
| `packages/shared/tests/laya-client.test.ts` | Tests unitarios del cliente |
| `packages/shared/tests/laya-integration.test.ts` | Tests de integración |
| `packages/db/prisma/schema.prisma` | Tabla `DecisionEvaluation` para persistencia |
| `services/laya/Dockerfile` | Docker image para Laya service |
| `services/laya/requirements.txt` | Dependencias Python |
| `docker-compose.yml` | Agregado servicio Laya |
| `docs/engineering/LAYA_ENV_EXAMPLE.md` | Variables de entorno de ejemplo |

### API del servicio Laya

```http
GET /health
Response: { "status": "ok", "modelLoaded": true }

POST /v1/decide
Request:
{
  "event": {
    "eventId": "evt_001",
    "source": "smartolt",
    "deviceKind": "ONU",
    "alarmType": "LOS",
    "rawSummary": "ONU-342 reports LOS..."
  }
}

Response:
{
  "decision": {
    "eventClass": "OPTICAL_FAULT",
    "severity": "HIGH",
    "probableScope": "PON",
    "suggestedRoute": "INVESTIGATION",
    "requiresInvestigation": true,
    "confidence": {
      "eventClass": 0.94,
      "severity": 0.91,
      "probableScope": 0.88,
      "suggestedRoute": 0.96
    }
  },
  "model": "laya-multilingual",
  "latencyMs": 31
}

POST /v1/batch
Request:
{
  "events": [
    { "eventId": "evt-1", "rawSummary": "..." },
    { "eventId": "evt-2", "rawSummary": "..." }
  ]
}
```

### Métricas Prometheus

```
ftth_laya_requests_total          # Total requests
ftth_laya_failures_total          # Failed requests
ftth_laya_timeouts_total         # Timeouts
ftth_laya_shadow_total           # Shadow mode decisions
ftth_laya_fallback_total         # Fallback activations
ftth_laya_latency_ms             # Histogram de latencia
ftth_laya_confidence             # Gauge de confianza promedio
ftth_laya_route_suggestion_total # Por route (DIRECT/ASSISTED/INVESTIGATION)
ftth_laya_shadow_agreement_total #shadow vs routing agreement
ftth_laya_shadow_disagreement_total
```

## Consecuencias

### Positivas
- Reducción potencial de llamadas LLM para eventos rutinarios
- Clasificación consistente de eventos de red
- Base para fine-tuning especializado en dominio FTTH

### Negativas
- Dependencia adicional (ONNX Runtime / modelo Laya)
- Latencia extra si Laya está en proceso
- Complejidad en feature flags y fallback

### Riesgos mitigados
- **Fail-open:** si Laya no responde, el pipeline actual sigue funcionando
- **Shadow mode:** ninguna decisión de Laya afecta producción hasta validar
- **Kill switch:** `LAYA_ENABLED=false` elimina Laya del flujo sin redeploy

---

## Fases de implementación

| Fase | Descripción | Criterio de salida |
|------|-------------|-------------------|
| 0 | ADR + contratos + pruebas de concepto | Este documento aprobado |
| 1 | Módulo Laya importable + client TypeScript | Laya responde correctamente a eventos hardcodeados |
| 2 | Shadow mode: persistir DecisionEvaluation, métricas | Datos reales de comparación disponibles |
| 3 | Dataset FTTH + benchmark | Reporte con métricas por clase |
| 4 | Assisted mode: inyectar señal layaSignal en adaptive-router | Umbrales de DEC-042-4 cumplidos |
| 5 | Fine-tuning (opcional, solo si se justifica) | Modelo especializado `ftth-copilot-laya-v1` |

---

## Referencias

- Documento de diseño completo: `/home/tecnodespegue/Descargas/laya-integration-ftth-copilot.md`
- Adaptive router existente: `packages/agent-core/src/adaptive-router.ts`
- Contratos existentes: `packages/shared/src/contracts.ts`
- Laya: https://github.com/NandhaKishorM/laya

---

## Notas

- Este ADR es minimalista por diseño. El documento de diseño completo contiene detalles de implementación, testing, Docker Compose, batch inference, y fine-tuning que se evaluarán en fases posteriores.
- La decisión DEC-042-1 (módulo vs microservicio) es reversible. Si el módulo importable presenta problemas, se migra a microservicio en la fase 4+.
