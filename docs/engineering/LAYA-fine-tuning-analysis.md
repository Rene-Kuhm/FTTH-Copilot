# Análisis: Dataset FTTH + Fine-tuning Laya + ROI

**Fecha:** 2026-09-27\
**Proyecto:** FTTH-Copilot — Laya Decision Layer

---

## PARTE 1: Dataset FTTH para Fine-tuning

### Estado actual del repositorio

El repositorio actualmente **NO posee datos históricos de producción**. Tiene:
- Seed sintético con 10 ONUs y 5 OLTs demo
- Estructura de tablas para almacenar eventos reales
- Sin datos de incidentes confirmados etiquetados por operadores

### Fuentes potenciales de datos

| Fuente | Disponibilidad | Formato actual | Valor para dataset |
|--------|---------------|----------------|-------------------|
| `DeviceEvent` (syslog) | Depende del operador | Raw messages | Alto — eventos crudos |
| `DetectedAlert` | Si hay detección activa | Alarmas categorizadas | Medio — ya tienen kind |
| `Incident` | Si hay incidentes | Agrupados por dispositivo | Alto — correlacionado |
| `ConfirmedIncident` | Solo si operador confirmó | Con rootCause + fix | **Muy alto** — ground truth |
| Logs SNMP/SmartOLT externos | Depende | Varía | Variable |

### dataset mínimo propuesto

```
dataset/
├── v1/
│   ├── train/
│   │   ├── onu_los.jsonl
│   │   ├── onu_dying_gasp.jsonl
│   │   ├── onu_low_rx.jsonl
│   │   ├── pon_mass_outage.jsonl
│   │   ├── olt_unreachable.jsonl
│   │   ├── olt_temperature.jsonl
│   │   ├── uplink_congestion.jsonl
│   │   ├── power_failure.jsonl
│   │   ├── splitter_suspected.jsonl
│   │   ├── normal.jsonl
│   │   └── unknown.jsonl
│   ├── val/
│   └── test/
├── schemas/
│   └── laya-training-record.json
└── README.md
```

### Formato de cada registro (Laya-compatible)

```json
{
  "id": "ftth-train-001",
  "event": {
    "source": "smartolt",
    "vendor": "Huawei",
    "deviceKind": "ONU",
    "deviceId": "ONU-342",
    "alarmType": "LOS",
    "rxPower": -27.8,
    "affectedOnus": 1,
    "dyingGasp": false,
    "rawSummary": "ONU-342 reports LOS. RX power dropped from -21.5 dBm."
  },
  "label": {
    "eventClass": "OPTICAL_FAULT",
    "severity": "MEDIUM",
    "probableScope": "ONU",
    "requiresInvestigation": true
  },
  "metadata": {
    "confirmedBy": "operator",
    "confirmedAt": "2025-03-15T14:30:00Z",
    "tenantId": "tenant-001",
    "sourceIncidentId": "INC-2025-0342"
  }
}
```

### Criterios de etiquetado

| Campo | Quién etiqueta | Criterio |
|-------|---------------|----------|
| `eventClass` | Ingeniero de red senior | Basado en causa raíz confirmada |
| `severity` | Operador NOC | Impacto operativo real |
| `probableScope` | Ingeniero de planta | Diagnóstico de campo |
| `requiresInvestigation` | Operador NOC | ¿Se necesitó investigar? |

### Cantidad mínima para fine-tuning viable

Según la documentación de Laya y benchmarks de modelos similares:

| Escenario | Mínimo | Recomendado |
|----------|--------|-------------|
| Fine-tuning inicial | 500 registros | 2,000 registros |
| Por clase de evento | 50 registros | 200 registros |
| Validación | 100 registros | 500 registros |

**Prioridad de clases a etiquetar primero:**

1. **MASS_OUTAGE** (crítico — el PoC falló en esto)
2. **OPTICAL_FAULT** vs **OPTICAL_DEGRADATION** (el PoC los confundió)
3. **DEVICE_FAULT** vs **POWER_FAULT** (temperatura alta clasificó como power)
4. **CONGESTION** vs **UPLINK_FAULT** (uplink congestionado → uplink_fault en vez de congestion)

---

## PARTE 2: Ruta Técnica de Fine-tuning

### Cómo funciona Laya

Laya usa un modelo base (DeBERTa-v3) que se entrena con preguntas tipadas (`choice`, `score`, `noul`). El checkpoint publicado (`laya-multilingual`) está entrenado con datasets genéricos.

### Pasos para fine-tuning FTTH

```
1. Preparar dataset etiquetado ( formato JSONL )
          ↓
2. Formatear como preguntas Laya (choice/score/noul)
          ↓
3. Entrenar con transformers (PEFT/LoRA recomendado)
          ↓
4. Exportar checkpoint optimizado (ONNX o safetensors)
          ↓
5. Subir a HuggingFace como ftth-copilot/laya-ftth-v1
          ↓
6. Actualizar LAYA_MODEL en ADR-042 feature flag
```

### Enfoque recomendado: PEFT/LoRA

Para fine-tuning eficiente sin reentrenar todo el modelo:

```python
# Pseudocódigo — no ejecutar aún
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForSequenceClassification

# Cargar modelo base de Laya
model = AutoModelForSequenceClassification.from_pretrained(
    "convaiinnovations/laya-multilingual"
)

# Aplicar LoRA para adaptación a dominio FTTH
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["query", "value"],
    lora_dropout=0.1,
    task_type="FEATURE_EXTRACTION"
)
model = get_peft_model(model, lora_config)

# Entrenar con dataset FTTH
# ... training loop ...

# Exportar checkpoint
model.save_pretrained("ftth-copilot/laya-ftth-v1")
```

### Recursos estimados para fine-tuning

| Recurso | Estimación |
|---------|------------|
| GPU | 1x NVIDIA T4 (16GB) o equivalente |
| Tiempo de entrenamiento | 2-4 horas con 2000 registros |
| RAM | 16GB mínimo |
| Almacenamiento | 5GB para checkpoints |

### Alternativa: Zero-shot con más contexto

Antes de fine-tunar, probar si con mejores prompts el modelo genérico mejora:

```python
QUESTIONS = {
    "event_class": {
        "type": "choice",
        "instructions": """Clasificar evento de red FTTH.
        Contexto: FTTH usa OLT → PON → Splitter → CTO → ONU.
        - OPTICAL_FAULT: pérdida total de señal óptica (LOS)
        - OPTICAL_DEGRADATION: señal deteriorándose pero activa
        - MASS_OUTAGE: múltiples ONUs afectadas simultáneamente
        - POWER_FAULT: patrón de dying gasp o corte de energía
        - DEVICE_FAULT: equipo específico (OLT, temperatura)
        - UPLINK_FAULT: uplink de agregación caído
        - CONGESTION: congestión de tráfico
        """,
        "criteria": {...}
    }
}
```

---

## Validación experimental con casos REALES

### Fuentes de datos reales consultadas

| Fuente | Tipo de datos | Casos |
|--------|---------------|-------|
| Huawei Technical Support | GPON LOS alarms, troubleshooting guides | Multiple |
| EXFO App Note 130 | Real FTTH troubleshooting cases | 4 |
| NetLink Trust Singapore | Mass outage (2000 users affected) | 1 |
| Viavi Solutions | Splitter/ODN failures | Multiple |
| Telecomate | Dying gasp configuration/troubleshooting | FAQ |
| PT ICON+ Indonesia | Rural network outages | 1 |
| Yantai China Unicom | Fiber cut (400 users) | 1 |

### Resultados con dataset BASADO EN CASOS REALES (15 eventos)

| Métrica | Valor |
|---------|-------|
| Precisión | **66.7%** |
| Latencia promedio | ~3s |

### Resultados por clase (dataset casos reales)

| Clase | Precisión | Observaciones |
|-------|-----------|---------------|
| NORMAL | 100% | El modelo reconoce "normal" fácilmente |
| POWER_FAULT | 100% | Dying gasp bien identificado |
| UPLINK_FAULT | 100% | Uplink failures bien detectados |
| CONGESTION | 100% | Alta utilización bien clasificada |
| OPTICAL_DEGRADATION | 100% | Macro bends y degradación gradual |
| UNKNOWN | 50% | Inconsistente |
| DEVICE_FAULT | 25% | Muy bajo, especialmente splitter-related |
| OPTICAL_FAULT | **0%** | No puede identificar faults ópticos simples |

### Comparación: sintético vs casos reales

| Métrica | Sintético (25 ev) | Casos Reales (15 ev) |
|---------|-------------------|---------------------|
| Precisión global | 64% | 66.7% |
| OPTICAL_FAULT | 0% | 0% |
| DEVICE_FAULT | 50% | 25% |
| POWER_FAULT | 50% | 100% |

### Conclusiones de validación

1. **Fine-tuning ES necesario** — OPTICAL_FAULT y DEVICE_FAULT tienen precisión muy baja
2. **Clases que SÍ funciona sin fine-tuning:** NORMAL, POWER_FAULT, UPLINK_FAULT, CONGESTION, OPTICAL_DEGRADATION
3. **Clases que FALLAN:** OPTICAL_FAULT (0%), DEVICE_FAULT (25%)
4. **El modelo genérico tiene limitaciones severas** para el dominio FTTH sin fine-tuning
5. **MASS_OUTAGE** necesita más datos para validar

## PARTE 3: Análisis de ROI

### Costos de implementación

| Fase | Esfuerzo estimado | Costo estimado |
|------|------------------|----------------|
| Dataset inicial (500 registros) | 1-2 semanas operador | $500-2000 |
| Fine-tuning v1 | 1 semana ML | $1000-3000 (GPU cloud) |
| Integración shadow mode | 2 semanas dev | $3000-5000 |
| Validación + ajuste | 2 semanas | $3000-5000 |
| **Total fase 1-4** | **7-9 semanas** | **$7500-15000** |

### Beneficios proyectados

Basado en el análisis del PoC y la arquitectura de FTTH-Copilot:

| Métrica | Sin Laya | Con Laya (post fine-tuning) | Ahorro |
|---------|----------|----------------------------|--------|
| Llamadas LLM por evento | 1-3 | 0-1 | 50-70% |
| Tokens por diagnóstico | 500-2000 | 100-500 | 60-75% |
| Latencia promedio | 5-15s | 2-5s | 60-70% |
| Costo LLM por 1000 eventos | $5-15 | $2-6 | 60% |

### Cálculo de ROI para diferentes volúmenes

> **Nota:** Los estimados asumen precisión post fine-tuning de 85%+. Con 64% actual (pre fine-tuning), los ahorros son menores porque el fallback al pipeline actual es más frecuente.

| Volumen mensual | Costo actual LLM | Costo con Laya (post FT) | Ahorro/mes | ROI (6 meses) |
|----------------|-----------------|--------------------------|------------|---------------|
| 100 eventos | $5-15 | $2-6 | $3-9 | Negativo |
| 1,000 eventos | $50-150 | $20-60 | $30-90 | ~$100-500 |
| 10,000 eventos | $500-1500 | $200-600 | $300-900 | $1800-5400 |
| 100,000 eventos | $5000-15000 | $2000-6000 | $3000-9000 | $18000-54000 |

### Tiempo de recuperación (payback)

```
Break-even point = Costo implementación / Ahorro mensual

Para 10,000 eventos/mes:
  - Inversión (Opción C): $2,000-5,000
  - Ahorro: $300-900/mes
  - Payback: 2-17 meses ⚠️

Para 100,000 eventos/mes:
  - Inversión (Opción C): $2,000-5,000
  - Ahorro: $3000-9000/mes
  - Payback: 0.2-2 meses ✅
```

### ROI ajustado por precisión actual (64%)

Con la precisión actual de 64% (sin fine-tuning), solo el 64% de eventos pueden usar el fast path:

| Volumen mensual | Eventos con Laya | Ahorro real/mes |
|----------------|-----------------|------------------|
| 1,000 eventos | 640 | $19-57 |
| 10,000 eventos | 6,400 | $192-576 |
| 100,000 eventos | 64,000 | $1920-5760 |

**Conclusión:** Sin fine-tuning, el ROI se reduce ~36%.

### ROI no monetizable pero valioso

| Beneficio | Valor |
|-----------|-------|
| Consistencia en clasificación | Alto — reduce variabilidad entre operadores |
| Escalabilidad | Alto — puede procesar eventos sin límite de turnos NOC |
| Priorización correcta | Alto — incidentes masivos se detectan antes |
| Auditoría | Medio — todas las decisiones quedan registradas |

---

## Recomendación

### Opción A: Fine-tuning inmediato
**Requiere:** Dataset de 500+ registros etiquetados por operador\
**Pros:** Mayor precisión (estimada 85%+ post fine-tuning)\
**Contras:** 7-9 semanas, $7500-15000, ROI negativo para <10k eventos/mes

### Opción B: Zero-shot con prompts mejorados
**Requiere:** Solo ajustar prompts en código\
**Pros:** 1-2 días, costo $0, prueba rápida\
**Contras:** Mejora limitada (estimada 60-70% vs 85%+ con fine-tuning)

### Opción C: Fine-tuning gradual (recomendada)
1. **Semana 1-2:** Recolectar 100-200 eventos reales, etiquetar
2. **Semana 3-4:** Probar con prompts mejorados
3. **Semana 5-8:** Fine-tuning con dataset acumulado
4. **Semana 9-12:** Shadow mode + validación

**Costo:** $2000-5000 (reducido)\
**Riesgo:** Bajo — se valida antes de invertir mucho

---

## Próximos pasos inmediatos

1. **Generar dataset inicial:** Crear 100 eventos sintéticos pero realistas basados en los 10 del PoC
2. **Etiquetar con operador:** 30 minutos con ingeniero de red senior para validar labeling
3. **Re-probar Laya:** Con prompts mejorados (Opción B)
4. **Decidir:** Si mejora a >70%, seguir con shadow mode. Si no, pasar a Opción C.

---

## Dataset generado

Se generó un dataset inicial de prueba:

```
dataset/laya-ftth/
├── v1/
│   └── train/
│       ├── ftth-events.jsonl     # 110 eventos
│       └── dataset_stats.json
└── generate_dataset.py           # Generador
```

**Distribución:** 9 clases balanceadas + 10% samples de negación

**Uso:** Para fine-tuning inicial o para mejorar prompts con más ejemplos.

## Datasets generados

### Dataset v1: Sintético
```
dataset/laya-ftth/v1/train/
├── ftth-events.jsonl     # 110 eventos sintéticos
└── dataset_stats.json
```

### Dataset v2: Basado en casos reales (RECOMENDADO)
```
dataset/laya-ftth/v2/train/
├── ftth-real-events.jsonl  # 100 eventos basados en casos documentados
├── case_sources.json       # Fuentes de los casos reales
├── generate_dataset.py      # Generador sintético
└── generate_realistic_dataset.py  # Generador basado en casos reales
```

**Composición del dataset v2:**
- 70% casos reales documentados (Huawei, EXFO, NetLink Trust, Viavi)
- 15% negaciones (eventos normales)
- 15% eventos ambiguos (UNKNOWN)

**21 casos base documentados** de:
- GPON LOS alarms y troubleshooting
- Dying gasp patterns
- Mass outages reales (Singapore, China)
- Splitter failures
- ODN faults
- Rogue ONUs
- OLT issues
- Configuration issues
- Normal operations

## Referencias

- Laya GitHub: https://github.com/NandhaKishorM/laya
- Checkpoint actual: `convaiinnovations/laya-multilingual`
- PEFT/LoRA: https://github.com/huggingface/peft
- ADR-042: `docs/engineering/ADR-042-laya-decision-layer.md`
- Huawei GPON Troubleshooting: https://info.support.huawei.com
- EXFO FTTH App Note: https://www.exfo.com
- Viavi PON Troubleshooting: https://www.viavisolutions.com
