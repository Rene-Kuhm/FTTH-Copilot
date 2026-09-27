# Resumen Ejecutivo: Laya Decision Layer para FTTH-Copilot

**Fecha:** 2026-09-27\
**Proyecto:** FTTH-Copilot

---

## Decisión requerida

¿Procedemos con la implementación de Laya como Fast Decision Layer (System 1)?

---

## Lo que sabemos

### 1. El modelo genérico NO sirve tal cual

| Clase | Precisión | Acción requerida |
|-------|-----------|------------------|
| NORMAL | 100% | Listo para usar |
| POWER_FAULT | 100% | Listo para usar |
| UPLINK_FAULT | 100% | Listo para usar |
| CONGESTION | 100% | Listo para usar |
| OPTICAL_DEGRADATION | 100% | Listo para usar |
| UNKNOWN | 50% | Fine-tuning |
| DEVICE_FAULT | 25% | Fine-tuning |
| OPTICAL_FAULT | 0% | Fine-tuning obligatorio |

### 2. Fine-tuning ES necesario

- **OPTICAL_FAULT** (0%) es crítico para el negocio — pérdidas de señal, cortes de fibra
- **DEVICE_FAULT** (25%) incluye fallas de OLT, splitters, temperature
- El modelo genérico no está calibrado para el dominio FTTH

### 3. Dataset real disponible

Generamos un dataset basado en **21 casos documentados** de fuentes confiables:
- Huawei Technical Support
- EXFO App Note 130
- NetLink Trust Singapore (outage real de 2000 usuarios)
- Viavi Solutions
- Casos de China, Indonesia, Singapore

### 4. ROI depende del volumen

| Volumen mensual | ROI | Recomendación |
|----------------|-----|---------------|
| < 1,000 eventos | Negativo | No justificar inversión |
| 1,000 - 10,000 | Marginal | Evaluar con shadow mode primero |
| > 10,000 eventos | Positivo | Proceder con fine-tuning |

---

## Opciones

### Opción A: No implementar Laya

**Pros:**
- No hay costo adicional
- No hay riesgo de mala clasificación

**Contras:**
- Se pierde reducción potencial de llamadas LLM
- No se mejora la escalabilidad

### Opción B: Shadow mode + prompts mejorados (inmediato)

**Pros:**
- Costo $0 adicional
- Sin riesgo — Laya solo observa
- Se colectan datos reales para futuro fine-tuning

**Contras:**
- Solo mejora marginal (66% → ~70%)
- No reduce costos hasta tener fine-tuning

### Opción C: Fine-tuning gradual (recomendado si volumen > 10k)

**Pros:**
- Precisión objetivo: 85%+
- Reducción real de llamadas LLM
- Escalabilidad

**Contras:**
- Inversión: $2,000-5,000
- Tiempo: 8-12 semanas
- Requiere dataset de producción real

---

## Recomendación

**Si el volumen de eventos es > 10k/mes:**

1. Implementar shadow mode + prompts mejorados (Opción B) — 2 semanas
2. Colectar datos reales durante 1 mes
3. Fine-tuning con dataset acumulado (Opción C) — 6-8 semanas
4. Habilitar assisted mode si métricas lo justifican

**Si el volumen es < 10k/mes:**

Mantener el pipeline actual. El ROI no justifica la complejidad.

---

## Próximos pasos si se aprueba

1. Aprobar ADR-042
2. Implementar cliente Laya en `packages/shared`
3. Configurar feature flags
4. Correr shadow mode por 2-4 semanas
5. Evaluar precisión con datos reales
6. Decidir sobre fine-tuning

---

## Documentos creados

| Archivo | Descripción |
|---------|-------------|
| `ADR-042-laya-decision-layer.md` | Decisiones arquitectónicas |
| `LAYA-fine-tuning-analysis.md` | Análisis completo |
| `dataset/laya-ftth/v2/train/ftth-real-events.jsonl` | 100 eventos basados en casos reales |
| `dataset/laya-ftth/generate_realistic_dataset.py` | Generador de dataset |

---

## Contacto

Para preguntas sobre este análisis, revisar:
- `docs/engineering/LAYA-fine-tuning-analysis.md` — análisis detallado
- `docs/engineering/ADR-042-laya-decision-layer.md` — decisiones técnicas
