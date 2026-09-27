#!/usr/bin/env python3
"""
Fine-tuning mínimo viable de Laya para FTTH.

Usa LoRA con los target_modules correctos para DeBERTa-v3.
"""

import argparse
import json
import os
import random
import sys
from pathlib import Path
from typing import Any

import torch
from peft import LoraConfig, get_peft_model, TaskType
from torch.utils.data import Dataset, DataLoader
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    get_linear_schedule_with_warmup,
)


# ── Constantes ────────────────────────────────────────────────────────────────

LAYA_MODEL = "microsoft/deberta-v3-base"

FTTH_CLASSES = [
    "NORMAL",
    "OPTICAL_DEGRADATION",
    "OPTICAL_FAULT",
    "POWER_FAULT",
    "DEVICE_FAULT",
    "UPLINK_FAULT",
    "CONGESTION",
    "MASS_OUTAGE",
    "UNKNOWN",
]

CLASS_TO_ID = {c: i for i, c in enumerate(FTTH_CLASSES)}
ID_TO_CLASS = {i: c for c, i in CLASS_TO_ID.items()}


class FTTHFineTuningDataset(Dataset):
    """Dataset para fine-tuning de clasificación FTTH."""
    
    def __init__(self, file_path: str, tokenizer, max_length: int = 128):
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.examples = self._load(file_path)
    
    def _load(self, file_path: str) -> list[dict]:
        examples = []
        with open(file_path) as f:
            for line in f:
                data = json.loads(line)
                event_class = data["answers"].get("event_class", {}).get("choice", "UNKNOWN")
                if event_class in CLASS_TO_ID:
                    examples.append({
                        "text": data["input"],
                        "label": CLASS_TO_ID[event_class],
                    })
        return examples
    
    def __len__(self) -> int:
        return len(self.examples)
    
    def __getitem__(self, idx: int) -> dict:
        example = self.examples[idx]
        encoding = self.tokenizer(
            example["text"],
            max_length=self.max_length,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )
        return {
            "input_ids": encoding["input_ids"].squeeze(),
            "attention_mask": encoding["attention_mask"].squeeze(),
            "labels": torch.tensor(example["label"], dtype=torch.long),
        }


def create_lora_model(model_name: str, num_labels: int):
    """Crea modelo con LoRA injection para DeBERTa-v3."""
    print(f"📦 Cargando modelo base: {model_name}")
    
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    
    model = AutoModelForSequenceClassification.from_pretrained(
        model_name,
        num_labels=num_labels,
        ignore_mismatched_sizes=True,
    )
    
    # DeBERTa-v3: query_proj, key_proj, value_proj
    lora_config = LoraConfig(
        r=8,
        lora_alpha=16,
        lora_dropout=0.1,
        target_modules=["query_proj", "key_proj", "value_proj"],
        task_type=TaskType.SEQ_CLS,
    )
    
    model = get_peft_model(model, lora_config)
    
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    
    print(f"   Parámetros entrenables: {trainable:,} / {total:,} ({trainable/total*100:.2f}%)")
    
    return model, tokenizer


def train_epoch(model, dataloader, optimizer, scheduler, device):
    """Entrena una época."""
    model.train()
    total_loss = 0
    
    for batch in dataloader:
        input_ids = batch["input_ids"].to(device)
        attention_mask = batch["attention_mask"].to(device)
        labels = batch["labels"].to(device)
        
        outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
        loss = outputs.loss
        
        loss.backward()
        optimizer.step()
        scheduler.step()
        optimizer.zero_grad()
        
        total_loss += loss.item()
    
    return total_loss / len(dataloader)


def evaluate(model, dataloader, device):
    """Evalúa el modelo."""
    model.eval()
    total_loss = 0
    correct = 0
    total = 0
    
    with torch.no_grad():
        for batch in dataloader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)
            
            outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
            total_loss += outputs.loss.item()
            
            preds = outputs.logits.argmax(dim=-1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)
    
    return total_loss / len(dataloader), correct / total if total > 0 else 0


def main():
    parser = argparse.ArgumentParser(description="Fine-tuning mínimo Laya FTTH")
    parser.add_argument("--train_data", type=str, required=True)
    parser.add_argument("--val_data", type=str)
    parser.add_argument("--output", type=str, required=True)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=4)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--max_length", type=int, default=128)
    parser.add_argument("--device", type=str, default="cpu")
    args = parser.parse_args()
    
    print("=" * 60)
    print("FINE-TUNING LAYA FTTH (CPU)")
    print("=" * 60)
    
    device = torch.device(args.device)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Crear modelo con LoRA
    model, tokenizer = create_lora_model(LAYA_MODEL, num_labels=len(FTTH_CLASSES))
    model = model.to(device)
    
    # Cargar datasets
    print(f"\n📂 Cargando dataset: {args.train_data}")
    train_dataset = FTTHFineTuningDataset(args.train_data, tokenizer, args.max_length)
    print(f"   Ejemplos: {len(train_dataset)}")
    
    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True)
    
    val_loader = None
    if args.val_data:
        val_dataset = FTTHFineTuningDataset(args.val_data, tokenizer, args.max_length)
        val_loader = DataLoader(val_dataset, batch_size=args.batch_size)
        print(f"   Ejemplos validación: {len(val_dataset)}")
    
    # Optimizer y scheduler
    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=args.lr,
    )
    total_steps = len(train_loader) * args.epochs
    scheduler = get_linear_schedule_with_warmup(
        optimizer,
        num_warmup_steps=int(0.1 * total_steps),
        num_training_steps=total_steps,
    )
    
    # Entrenamiento
    print(f"\n🚀 Entrenando {args.epochs} épocas...")
    best_acc = 0
    
    for epoch in range(args.epochs):
        train_loss = train_epoch(model, train_loader, optimizer, scheduler, device)
        
        if val_loader:
            val_loss, val_acc = evaluate(model, val_loader, device)
            print(f"   Época {epoch+1}: loss={train_loss:.4f}, val_loss={val_loss:.4f}, val_acc={val_acc:.2%}")
            
            if val_acc > best_acc:
                best_acc = val_acc
                model.save_pretrained(output_dir)
                tokenizer.save_pretrained(output_dir)
        else:
            print(f"   Época {epoch+1}: loss={train_loss:.4f}")
    
    # Guardar modelo final
    print(f"\n💾 Guardando modelo en: {output_dir}")
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    
    # Guardar config
    config = {
        "model_name": LAYA_MODEL,
        "classes": FTTH_CLASSES,
        "class_to_id": CLASS_TO_ID,
        "num_epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.lr,
        "best_val_acc": best_acc,
    }
    with open(output_dir / "config.json", "w") as f:
        json.dump(config, f, indent=2)
    
    print("\n✅ Fine-tuning completado!")
    print(f"   Mejor accuracy de validación: {best_acc:.2%}")


if __name__ == "__main__":
    main()
