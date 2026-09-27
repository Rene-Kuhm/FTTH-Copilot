# Fine-tuning Laya para FTTH

## Evaluación Actual

| Modelo | Accuracy | Notas |
|--------|----------|-------|
| Base (laya-multilingual) | 50.7% | 5/9 clases < 70% |

**Fine-tuning obligatorio** para: OPTICAL_FAULT, DEVICE_FAULT, MASS_OUTAGE, POWER_FAULT

---

## Opciones de Fine-tuning

### 1. Google Colab (Recomendado) ⭐

GPU T4 gratuita, ~30-45 minutos.

**Pasos:**
1. Abrir `colab_finetune_simple.ipynb` en Google Colab
2. Runtime > Change runtime type > GPU
3. Runtime > Run all

**Link directo:** [Abrir en Colab](https://colab.research.google.com/github/tecnodespegue/FTTH-Copilot/blob/main/dataset/laya-ftth/colab_finetune_simple.ipynb)

### 2. Kaggle (Alternativa gratuita)

1. Crear notebook en Kaggle
2. Activar GPU (P100 o T4)
3. Clonar repo: `!git clone https://github.com/tecnodespegue/FTTH-Copilot.git`
4. Seguir los mismos pasos que Colab

### 3. Lambda Labs / Paperspace (GPU en la nube)

```bash
# Crear instancia con GPU
# Instalar dependencias
pip install peft transformers accelerate torch

# Clonar repo
git clone https://github.com/tecnodespegue/FTTH-Copilot.git
cd FTTH-Copilot

# Ejecutar fine-tuning
python3 dataset/laya-ftth/finetune_minimal.py \
    --train_data dataset/laya-ftth/v3/train/train/laya-format.jsonl \
    --val_data dataset/laya-ftth/v3/train/val/laya-format.jsonl \
    --output ./ftth-laya-v1 \
    --epochs 5 \
    --batch_size 8 \
    --lr 1e-4 \
    --device cuda
```

### 4. CPU Local (Alternativa lenta)

```bash
source .venv-laya/bin/activate

python3 dataset/laya-ftth/finetune_cpu.py \
    --train_data dataset/laya-ftth/v3/train/train/laya-format.jsonl \
    --val_data dataset/laya-ftth/v3/train/val/laya-format.jsonl \
    --output ./ftth-distilbert-v1 \
    --epochs 3 \
    --batch_size 8 \
    --device cpu
```

**Nota:** Tardará ~2-4 horas en CPU, pero produce un modelo funcional.

---

## Datasets

```
dataset/laya-ftth/v3/
├── train/
│   ├── train/laya-format.jsonl  (144) ← Entrenamiento
│   ├── val/laya-format.jsonl      (18)  ← Validación
│   └── test/laya-format.jsonl     (18)  ← Test
└── balanced.jsonl                 (180) ← Original balanceado
```

### Distribución por clase

| Clase | Train | Val | Test |
|-------|-------|-----|------|
| NORMAL | 6 | 2 | 3 |
| OPTICAL_DEGRADATION | 16 | 2 | 3 |
| OPTICAL_FAULT | 22 | 2 | 4 |
| POWER_FAULT | 19 | 2 | 1 |
| DEVICE_FAULT | 25 | 2 | 1 |
| UPLINK_FAULT | 17 | 2 | 1 |
| CONGESTION | 16 | 2 | 3 |
| MASS_OUTAGE | 17 | 2 | 1 |
| UNKNOWN | 6 | 2 | 1 |
| **Total** | **144** | **18** | **18** |

---

## Scripts Disponibles

| Script | Descripción | GPU |
|--------|-------------|-----|
| `colab_finetune_simple.ipynb` | Notebook Colab listo para ejecutar | T4 |
| `colab_finetune.ipynb` | Notebook Colab completo con más opciones | T4 |
| `finetune_minimal.py` | Fine-tuning con DeBERTa-v3 | Sí |
| `finetune_cpu.py` | Fine-tuning con DistilBERT (CPU) | No |
| `score_ftth.py` | Evaluación del modelo | No |
| `benchmark_ftth.py` | Benchmark completo | No |

---

## Post Fine-tuning

1. **Descargar modelo** de Colab/Kaggle
2. **Guardar** en `models/ftth-laya-v1/`
3. **Actualizar** `LAYA_MODEL` en `.env`:
   ```
   LAYA_MODEL=models/ftth-laya-v1
   ```
4. **Evaluar** con `benchmark_ftth.py`:
   ```bash
   python3 benchmark_ftth.py \
       --dataset v3/train/test/laya-format.jsonl \
       --model_finetuned ./ftth-laya-v1
   ```

---

## Metas de Precision

| Clase | Meta | Crítico |
|-------|------|---------|
| NORMAL | >95% | No |
| UPLINK_FAULT | >90% | No |
| CONGESTION | >90% | No |
| OPTICAL_DEGRADATION | >85% | No |
| OPTICAL_FAULT | >80% | **Sí** |
| DEVICE_FAULT | >80% | **Sí** |
| MASS_OUTAGE | >80% | **Sí** |
| POWER_FAULT | >80% | **Sí** |
| **GLOBAL** | **>85%** | - |
