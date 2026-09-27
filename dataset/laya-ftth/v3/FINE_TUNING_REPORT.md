# Fine-tuning Laya para FTTH - Reporte de Evaluación

## Fecha
2024-09-27

## Modelos evaluados

- **Modelo base**: `convaiinnovations/laya-multilingual`
- **Dataset**: v3 (balanceado, 180 eventos)

---

## Resultados de Evaluación

### Train Set (144 eventos)

| Clase | Precisión | Muestra |
|-------|-----------|----------|
| NORMAL | **100%** | 6 |
| UPLINK_FAULT | **100%** | 17 |
| CONGESTION | 75.0% | 16 |
| OPTICAL_DEGRADATION | 62.5% | 16 |
| POWER_FAULT | 47.4% | 19 |
| UNKNOWN | 33.3% | 6 |
| MASS_OUTAGE | 29.4% | 17 |
| OPTICAL_FAULT | 27.3% | 22 |
| DEVICE_FAULT | **24.0%** | 25 |
| **GLOBAL** | **50.7%** | 144 |

### Test Set (18 eventos)

| Clase | Precisión | Muestra |
|-------|-----------|----------|
| NORMAL | **100%** | 3 |
| CONGESTION | **100%** | 3 |
| UPLINK_FAULT | **100%** | 1 |
| OPTICAL_DEGRADATION | 66.7% | 3 |
| OPTICAL_FAULT | **0%** | 4 |
| DEVICE_FAULT | **0%** | 1 |
| MASS_OUTAGE | **0%** | 1 |
| POWER_FAULT | **0%** | 1 |
| UNKNOWN | **0%** | 1 |
| **GLOBAL** | **50.0%** | 18 |

---

## Análisis de Fallas

### Clases Críticas (precisión < 70%)

1. **OPTICAL_FAULT** (0-27%): El modelo confunde con otras clases ópticas
   - Problema: No distingue entre degradación gradual y corte de fibra
   - Solución: Más ejemplos con lenguaje específico de optical fault

2. **DEVICE_FAULT** (0-24%): El modelo no reconoce fallas de hardware
   - Problema: "board failure", "temperature" son términos no familiares
   - Solución: Más ejemplos con terminología de equipos

3. **MASS_OUTAGE** (0-29%): No reconoce patrones de outage masivo
   - Problema: "multiple", "affected" requieren contexto
   - Solución: Más ejemplos con counts y scale

4. **POWER_FAULT** (0-47%): Confunde con otros tipos de fallas
   - Problema: Dying gasp, battery son específicos
   - Solución: Más ejemplos con power-related terms

### Clases Funcionales (precisión >= 70%)

- **NORMAL**: 100% - Funciona bien
- **UPLINK_FAULT**: 100% - Funciona bien
- **CONGESTION**: 75% - Aceptable, necesita mejoras menores

---

## Recomendaciones

### Inmediato (Fine-tuning requerido)

1. **Fine-tuning con más datos**
   - Mínimo: 500 ejemplos balanceados
   - Recomendado: 1000+ ejemplos
   - Prioridad: OPTICAL_FAULT, DEVICE_FAULT, MASS_OUTAGE

2. **Data augmentation**
   - Variar vendors: Huawei, Nokia, ZTE
   - Variar OLT/ONU IDs
   - Variar counts (affected ONUs)

3. **Fine-tuning strategy**
   - Approach: LoRA (PEFT)
   - Rank: 16-32
   - Learning rate: 1e-4 a 2e-4
   - Epochs: 3-5

### Postergado

- Ensemble con múltiples modelos
- Calibración de confianza
- Custom training loop con métricas FTTH específicas

---

## Siguiente Paso

Para ejecutar fine-tuning en GPU:

```bash
python3 finetune_minimal.py \
    --train_data dataset/laya-ftth/v3/train/train/laya-format.jsonl \
    --val_data dataset/laya-ftth/v3/train/val/laya-format.jsonl \
    --output ./ftth-laya-v1 \
    --epochs 5 \
    --batch_size 8 \
    --lr 1e-4 \
    --device cuda
```

---

## Archivos Generados

```
dataset/laya-ftth/
├── v1/           # Sintético original
├── v2/           # Basado en casos reales
│   └── train/ftth-real-events.jsonl (100 eventos)
├── v3/           # Balanceado para fine-tuning
│   ├── train/
│   │   ├── train/laya-format.jsonl (144)
│   │   ├── val/laya-format.jsonl (18)
│   │   └── test/laya-format.jsonl (18)
│   ├── train/balanced.jsonl (180)
│   ├── FINE_TUNING_REPORT.md
│   └── FINE_TUNING_RESULTS.json
├── prepare_ftth_dataset.py
├── generate_balanced.py
├── finetune_minimal.py
├── score_ftth.py
└── finetune_guide.md
```
