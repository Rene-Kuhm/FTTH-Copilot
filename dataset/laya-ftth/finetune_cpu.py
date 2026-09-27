#!/usr/bin/env python3
"""
Fine-tuning CPU-friendly para FTTH usando DistilBERT.

Este script usa DistilBERT en lugar de DeBERTa-v3 para que
funcione en CPU sin GPU. Es ~10x más lento que GPU pero
produce resultados comparables.

Uso:
    python3 finetune_cpu.py \
        --train_data v3/train/train/laya-format.jsonl \
        --val_data v3/train/val/laya-format.jsonl \
        --output ./ftth-distilbert-v1
"""

import argparse
import json
import random
import time
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model, TaskType
from torch.utils.data import Dataset, DataLoader
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    get_linear_schedule_with_warmup,
)


# ── Constantes ────────────────────────────────────────────────────────────────

MODEL_NAME = "distilbert-base-uncased"  # Mucho más pequeño que DeBERTa-v3

FTTH_CLASSES = [
    "NORMAL", "OPTICAL_DEGRADATION", "OPTICAL_FAULT",
    "POWER_FAULT", "DEVICE_FAULT", "UPLINK_FAULT",
    "CONGESTION", "MASS_OUTAGE", "UNKNOWN",
]
CLASS_TO_ID = {c: i for i, c in enumerate(FTTH_CLASSES)}
ID_TO_CLASS = {i: c for c, i in CLASS_TO_ID.items()}


class FTTHDataset(Dataset):
    """Dataset simple para FTTH."""

    def __init__(self, path: str, tokenizer, max_len: int = 128):
        self.tokenizer = tokenizer
        self.data = []
        with open(path) as f:
            for line in f:
                r = json.loads(line)
                ec = r["answers"].get("event_class", {}).get("choice", "UNKNOWN")
                if ec in CLASS_TO_ID:
                    self.data.append({"text": r["input"], "label": CLASS_TO_ID[ec]})

    def __len__(self) -> int:
        return len(self.data)

    def __getitem__(self, idx: int) -> dict:
        ex = self.data[idx]
        enc = self.tokenizer(
            ex["text"],
            max_length=128,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )
        return {
            "input_ids": enc["input_ids"].squeeze(),
            "attention_mask": enc["attention_mask"].squeeze(),
            "labels": torch.tensor(ex["label"]),
        }


def train_epoch(model, loader, optimizer, scheduler, device) -> float:
    """Entrena una época."""
    model.train()
    total_loss = 0

    for batch in loader:
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

    return total_loss / len(loader)


def evaluate(model, loader, device) -> tuple[float, float]:
    """Evalúa el modelo."""
    model.eval()
    total_loss = 0
    correct = 0
    total = 0

    with torch.no_grad():
        for batch in loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)

            outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
            total_loss += outputs.loss.item()

            preds = outputs.logits.argmax(dim=-1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)

    return total_loss / len(loader), correct / total if total > 0 else 0


def main():
    parser = argparse.ArgumentParser(description="Fine-tuning CPU-friendly FTTH")
    parser.add_argument("--train_data", type=str, required=True)
    parser.add_argument("--val_data", type=str)
    parser.add_argument("--output", type=str, required=True)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--max_len", type=int, default=128)
    parser.add_argument("--device", type=str, default="cpu")
    args = parser.parse_args()

    print("=" * 60)
    print("FINE-TUNING CPU (DistilBERT)")
    print("=" * 60)

    device = torch.device(args.device)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Cargar tokenizer
    print("\n📦 Cargando tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Cargar modelo
    print(f"📦 Cargando modelo: {MODEL_NAME}")
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=len(FTTH_CLASSES),
        ignore_mismatched_sizes=True,
    )

    # LoRA (más simple para CPU)
    lora_config = LoraConfig(
        r=8,
        lora_alpha=16,
        lora_dropout=0.1,
        target_modules=["q_lin", "v_lin"],  # DistilBERT attention
        task_type=TaskType.SEQ_CLS,
    )
    model = get_peft_model(model, lora_config)

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"   Parámetros entrenables: {trainable:,} / {total:,} ({trainable/total*100:.2f}%)")

    model = model.to(device)

    # Datasets
    print(f"\n📂 Cargando dataset: {args.train_data}")
    train_dataset = FTTHDataset(args.train_data, tokenizer)
    print(f"   Train: {len(train_dataset)} ejemplos")

    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True)

    val_loader = None
    if args.val_data:
        val_dataset = FTTHDataset(args.val_data, tokenizer)
        val_loader = DataLoader(val_dataset, batch_size=args.batch_size)
        print(f"   Val: {len(val_dataset)} ejemplos")

    # Optimizer
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
    print(f"\n🚀 Entrenando {args.epochs} épocas (CPU)...")
    print("   Esto tomará ~30-60 minutos en CPU moderno")
    best_acc = 0

    for epoch in range(args.epochs):
        start = time.time()
        train_loss = train_epoch(model, train_loader, optimizer, scheduler, device)
        elapsed = time.time() - start

        if val_loader:
            val_loss, val_acc = evaluate(model, val_loader, device)
            print(f"   Época {epoch+1}: loss={train_loss:.4f}, val_acc={val_acc:.2%}, tiempo={elapsed:.0f}s")

            if val_acc > best_acc:
                best_acc = val_acc
                model.save_pretrained(output_dir)
                tokenizer.save_pretrained(output_dir)
        else:
            print(f"   Época {epoch+1}: loss={train_loss:.4f}, tiempo={elapsed:.0f}s")

    # Guardar
    print(f"\n💾 Guardando modelo en: {output_dir}")
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    config = {
        "model_name": MODEL_NAME,
        "classes": FTTH_CLASSES,
        "class_to_id": CLASS_TO_ID,
        "epochs": args.epochs,
        "best_val_acc": best_acc,
    }
    with open(output_dir / "config.json", "w") as f:
        json.dump(config, f, indent=2)

    print(f"\n✅ Fine-tuning completado!")
    print(f"   Mejor accuracy: {best_acc:.2%}")


if __name__ == "__main__":
    main()
