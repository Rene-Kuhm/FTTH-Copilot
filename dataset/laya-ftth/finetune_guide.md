# Fine-tuning Guide: Laya para FTTH

## Estado actual

### Benchmark del modelo base (laya-multilingual)

| Clase | Precisión | Muestra |
|-------|-----------|----------|
| CONGESTION | 100% | 3 |
| NORMAL | 100% | 3 |
| OPTICAL_DEGRADATION | 67% | 3 |
| OPTICAL_FAULT | **0%** | 4 |
| DEVICE_FAULT | **0%** | 1 |
| MASS_OUTAGE | **0%** | 1 |
| POWER_FAULT | **0%** | 1 |
| UNKNOWN | **0%** | 1 |
| UPLINK_FAULT | 100% | 1 |
| **GLOBAL** | **50%** | 18 |

**Conclusión:** Fine-tuning es obligatorio para OPTICAL_FAULT, DEVICE_FAULT, MASS_OUTAGE, POWER_FAULT.

---

## Datasets generados

```
dataset/laya-ftth/
├── v1/  # Sintético original (110 registros)
├── v2/  # Basado en casos reales (100 registros)
│   └── train/ftth-real-events.jsonl
├── v3/  # Balanceado para fine-tuning (180 registros)
│   └── train/
│       ├── balanced.jsonl
│       ├── train/laya-format.jsonl (144)
│       ├── val/laya-format.jsonl (18)
│       └── test/laya-format.jsonl (18)
├── prepare_ftth_dataset.py
├── generate_balanced.py
├── finetune_minimal.py
└── benchmark_ftth.py
```

---

## Para ejecutar fine-tuning

### Requisitos

1. **GPU** (recomendado): NVIDIA con 8GB+ VRAM
2. **Alternativa CPU**: Funciona pero es ~10x más lento

### Instalación

```bash
# Crear entorno virtual
python3 -m venv .venv-ft
source .venv-ft/bin/activate

# Instalar dependencias
pip install laya peft transformers accelerate torch
```

### Fine-tuning en GPU (30-60 minutos)

```bash
source .venv-ft/bin/activate

python3 finetune_minimal.py \
    --train_data v3/train/balanced.jsonl \
    --val_data v3/train/val/laya-format.jsonl \
    --output ./ftth-laya-v1 \
    --epochs 5 \
    --batch_size 8 \
    --lr 1e-4 \
    --device cuda
```

### Fine-tuning en CPU (varias horas)

```bash
source .venv-ft/bin/activate

python3 finetune_minimal.py \
    --train_data v3/train/balanced.jsonl \
    --val_data v3/train/val/laya-format.jsonl \
    --output ./ftth-laya-v1 \
    --epochs 3 \
    --batch_size 4 \
    --lr 5e-5 \
    --device cpu
```

---

## Benchmark post fine-tuning

Después de fine-tuning, ejecutar:

```bash
python3 benchmark_ftth.py \
    --dataset v3/train/test/laya-format.jsonl \
    --model_base convaiinnovations/laya-multilingual \
    --model_finetuned ./ftth-laya-v1 \
    --output benchmark_final.json
```

---

## Metas de precisión post fine-tuning

| Clase | Meta |
|-------|------|
| NORMAL | >95% |
| POWER_FAULT | >90% |
| UPLINK_FAULT | >90% |
| CONGESTION | >90% |
| OPTICAL_DEGRADATION | >85% |
| DEVICE_FAULT | >80% |
| OPTICAL_FAULT | >80% |
| MASS_OUTAGE | >80% |
| UNKNOWN | >75% |
| **GLOBAL** | **>85%** |

---

## Para producción

1. **Validar** con el test set después de fine-tuning
2. **Comparar** con el modelo base
3. **Si las métricas mejoran**, exportar checkpoint
4. **Subir** a HuggingFace: `ftth-copilot/laya-ftth-v1`
5. **Actualizar** `LAYA_MODEL` en ADR-042

---

## Scripts disponibles

| Script | Descripción |
|--------|-------------|
| `prepare_ftth_dataset.py` | Convierte dataset al formato Laya |
| `generate_balanced.py` | Genera dataset balanceado |
| `finetune_minimal.py` | Fine-tuning con LoRA |
| `benchmark_ftth.py` | Compara modelo base vs fine-tuned |
