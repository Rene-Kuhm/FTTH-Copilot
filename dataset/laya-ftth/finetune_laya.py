#!/usr/bin/env python3
"""
Fine-tuning de Laya para FTTH usando PEFT/LoRA.

Este script fine-tunea el modelo Laya (DeBERTa-v3) en el dataset FTTH
usando Low-Rank Adaptation (LoRA) para eficiencia.

Uso:
    python3 finetune_laya.py \
        --model convaiinnovations/laya-multilingual \
        --train_data v2/train/laya-training.jsonl \
        --output ftth-laya-v1 \
        --epochs 3 \
        --batch_size 8 \
        --learning_rate 2e-4 \
        --device cpu
"""

import argparse
import json
import os
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import torch
from peft import LoraConfig, get_peft_model, TaskType
from torch.utils.data import DataLoader, Dataset
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
    DataCollatorWithPadding,
)


@dataclass
class LayaTrainingExample:
    """Un ejemplo de entrenamiento para Laya."""
    input_text: str
    questions: dict[str, Any]
    answers: dict[str, Any]
    metadata: dict = field(default_factory=dict)


class FTTHDataset(Dataset):
    """Dataset de eventos FTTH para fine-tuning."""
    
    def __init__(self, file_path: str, tokenizer: AutoTokenizer, max_length: int = 256):
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.examples = self._load(file_path)
        
    def _load(self, file_path: str) -> list[LayaTrainingExample]:
        examples = []
        with open(file_path) as f:
            for line in f:
                data = json.loads(line)
                examples.append(LayaTrainingExample(
                    input_text=data["input"],
                    questions=data["questions"],
                    answers=data["answers"],
                    metadata=data.get("metadata", {}),
                ))
        return examples
    
    def __len__(self) -> int:
        return len(self.examples)
    
    def __getitem__(self, idx: int) -> dict:
        example = self.examples[idx]
        
        # Tokenizar el texto de entrada
        encoding = self.tokenizer(
            example.input_text,
            max_length=self.max_length,
            padding=False,
            truncation=True,
        )
        
        return {
            "input_ids": encoding["input_ids"],
            "attention_mask": encoding["attention_mask"],
            "example": example,
        }


def load_ftth_dataset(file_path: str) -> list[dict]:
    """Carga el dataset FTTH desde JSONL."""
    records = []
    with open(file_path) as f:
        for line in f:
            records.append(json.loads(line))
    return records


def create_lora_config(rank: int = 16, lora_alpha: int = 32, dropout: float = 0.1) -> LoraConfig:
    """Crea configuración LoRA para fine-tuning."""
    return LoraConfig(
        r=rank,
        lora_alpha=lora_alpha,
        lora_dropout=dropout,
        target_modules=["query", "value"],
        task_type=TaskType.SEQ_CLS,
    )


def train_laya(
    model_name: str,
    train_data: str,
    val_data: str | None,
    output_dir: str,
    epochs: int = 3,
    batch_size: int = 8,
    learning_rate: float = 2e-4,
    device: str = "cpu",
    max_length: int = 256,
):
    """
    Entrena Laya en el dataset FTTH usando LoRA.
    """
    print("=" * 60)
    print("FINE-TUNING LAYA PARA FTTH")
    print("=" * 60)
    
    # Cargar tokenizer
    print(f"\n📦 Cargando tokenizer: {model_name}")
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    
    # Cargar modelo base
    print(f"\n📦 Cargando modelo: {model_name}")
    model = AutoModelForSequenceClassification.from_pretrained(
        model_name,
        num_labels=2,  # Placeholder, se ajusta después
        ignore_mismatched_sizes=True,
    )
    
    # Crear dataset
    print(f"\n📂 Cargando dataset de entrenamiento: {train_data}")
    train_dataset = FTTHDataset(train_data, tokenizer, max_length)
    print(f"   Ejemplos de entrenamiento: {len(train_dataset)}")
    
    val_dataset = None
    if val_data:
        print(f"📂 Cargando dataset de validación: {val_data}")
        val_dataset = FTTHDataset(val_data, tokenizer, max_length)
        print(f"   Ejemplos de validación: {len(val_dataset)}")
    
    # Aplicar LoRA
    print("\n⚙️  Configurando LoRA...")
    lora_config = create_lora_config()
    model = get_peft_model(model, lora_config)
    
    print(f"   Parámetros entrenables: {sum(p.numel() for p in model.parameters() if p.requires_grad):,}")
    print(f"   Parámetros totales: {sum(p.numel() for p in model.parameters()):,}")
    
    # Configuración de entrenamiento
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        learning_rate=learning_rate,
        warmup_ratio=0.1,
        weight_decay=0.01,
        logging_dir=f"{output_dir}/logs",
        logging_steps=10,
        eval_strategy="epoch" if val_dataset else "no",
        save_strategy="epoch",
        save_total_limit=2,
        load_best_model_at_end=True if val_dataset else False,
        fp16=False,  # CPU no soporta fp16
        report_to="none",
        seed=42,
    )
    
    # Data collator
    data_collator = DataCollatorWithPadding(tokenizer=tokenizer)
    
    # Trainer
    print("\n🚀 Iniciando entrenamiento...")
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        data_collator=data_collator,
    )
    
    # Entrenar
    trainer.train()
    
    # Guardar modelo
    print(f"\n💾 Guardando modelo en: {output_dir}")
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    
    # Guardar config de LoRA
    lora_config.save_pretrained(output_dir)
    
    print("\n✅ Fine-tuning completado!")
    
    return model, tokenizer


def evaluate_model(
    model,
    tokenizer,
    test_data: str,
    device: str = "cpu",
):
    """Evalúa el modelo fine-tuned en el dataset de test."""
    print("\n📊 Evaluando modelo...")
    
    test_records = load_ftth_dataset(test_data)
    
    correct = 0
    total = 0
    class_correct = {}
    class_total = {}
    
    model.eval()
    
    for record in test_records:
        input_text = record["input"]
        true_class = record["answers"].get("event_class", {}).get("choice")
        
        if not true_class:
            continue
        
        # Tokenizar
        inputs = tokenizer(
            input_text,
            return_tensors="pt",
            truncation=True,
            max_length=256,
        )
        
        # Predecir
        with torch.no_grad():
            outputs = model(**inputs)
            pred_idx = outputs.logits.argmax().item()
        
        # Mapear predicción a clase (esto depende del tokenizador)
        # Por ahora solo contamos accuracy global
        total += 1
        
        if true_class not in class_total:
            class_total[true_class] = 0
            class_correct[true_class] = 0
        
        class_total[true_class] += 1
    
    # Reporte
    print("\n" + "=" * 40)
    print("RESULTADOS DE EVALUACIÓN")
    print("=" * 40)
    print(f"Accuracy global: {correct}/{total} = {correct/total*100:.1f}%" if total > 0 else "No evaluable")
    
    print("\nPor clase:")
    for cls in sorted(class_total.keys()):
        print(f"  {cls:<22}: {class_correct.get(cls, 0)}/{class_total[cls]}")


def main():
    parser = argparse.ArgumentParser(
        description="Fine-tune Laya para FTTH"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="convaiinnovations/laya-multilingual",
        help="Modelo base de HuggingFace",
    )
    parser.add_argument(
        "--train_data",
        type=str,
        required=True,
        help="Dataset de entrenamiento (JSONL)",
    )
    parser.add_argument(
        "--val_data",
        type=str,
        help="Dataset de validación (JSONL)",
    )
    parser.add_argument(
        "--test_data",
        type=str,
        help="Dataset de test (JSONL)",
    )
    parser.add_argument(
        "--output",
        type=str,
        required=True,
        help="Directorio de salida para el modelo",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=3,
        help="Número de épocas",
    )
    parser.add_argument(
        "--batch_size",
        type=int,
        default=8,
        help="Batch size",
    )
    parser.add_argument(
        "--learning_rate",
        type=float,
        default=2e-4,
        help="Learning rate",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        choices=["cpu", "cuda", "mps"],
        help="Device para entrenamiento",
    )
    parser.add_argument(
        "--max_length",
        type=int,
        default=256,
        help="Máxima longitud de secuencia",
    )
    parser.add_argument(
        "--lora_rank",
        type=int,
        default=16,
        help="Rango LoRA",
    )
    
    args = parser.parse_args()
    
    # Crear output dir
    Path(args.output).mkdir(parents=True, exist_ok=True)
    
    # Entrenar
    train_laya(
        model_name=args.model,
        train_data=args.train_data,
        val_data=args.val_data,
        output_dir=args.output,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        device=args.device,
        max_length=args.max_length,
    )
    
    # Evaluar si hay test data
    if args.test_data:
        print("\n" + "=" * 60)
        print("NOTA: La evaluación detallada requiere reimplementar")
        print("el head de clasificación de Laya. Usa el benchmark")
        print("script para validar el modelo fine-tuned.")
        print("=" * 60)


if __name__ == "__main__":
    main()
