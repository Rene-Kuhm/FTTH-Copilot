#!/usr/bin/env python3
"""
Script de evaluación y scoring para el modelo Laya FTTH.

Este script usa el modelo Laya original (sin fine-tuning) para generar
un baseline y documenta qué se necesita para mejorar.
"""

import json
from collections import Counter
from laya import Router


QUESTIONS = {
    "event_class": {
        "type": "choice",
        "instructions": """Classify this FTTH network event.
FTTH hierarchy: OLT → PON → Splitter → CTO → ONU
Event classes:
- NORMAL: No operational fault
- OPTICAL_DEGRADATION: Signal gradually deteriorating but service may work
- OPTICAL_FAULT: Loss of optical connectivity (LOS, fiber cut, connector failure)
- POWER_FAULT: Power-related failure or dying gasp pattern
- DEVICE_FAULT: Equipment-specific fault (OLT temp, board failure, hardware)
- UPLINK_FAULT: OLT or aggregation uplink issue
- CONGESTION: Traffic congestion, high bandwidth utilization
- MASS_OUTAGE: Multiple subscribers affected by common upstream cause
- UNKNOWN: Evidence insufficient to classify""",
        "criteria": {
            "NORMAL": "No operational fault",
            "OPTICAL_DEGRADATION": "Signal gradually deteriorating",
            "OPTICAL_FAULT": "Loss of optical connectivity",
            "POWER_FAULT": "Power-related failure",
            "DEVICE_FAULT": "Equipment-specific fault",
            "UPLINK_FAULT": "Uplink issue",
            "CONGESTION": "Traffic congestion",
            "MASS_OUTAGE": "Multiple subscribers affected",
            "UNKNOWN": "Evidence insufficient",
        },
    },
}


def load_dataset(path: str) -> list[dict]:
    records = []
    with open(path) as f:
        for line in f:
            records.append(json.loads(line))
    return records


def evaluate_laya(router: Router, dataset: list[dict]) -> dict:
    """Evalúa Laya en el dataset FTTH."""
    
    results = {
        "total": 0,
        "correct": 0,
        "by_class": {},
    }
    
    for record in dataset:
        input_text = record["input"]
        true_class = record["answers"].get("event_class", {}).get("choice", "UNKNOWN")
        
        if not true_class:
            continue
        
        try:
            decisions = router.decide(state=input_text, questions=QUESTIONS)
            pred_class = decisions.get("event_class", {}).get("choice", "UNKNOWN")
            
            is_correct = pred_class == true_class
            
            if true_class not in results["by_class"]:
                results["by_class"][true_class] = {"correct": 0, "total": 0}
            
            results["by_class"][true_class]["total"] += 1
            if is_correct:
                results["by_class"][true_class]["correct"] += 1
                results["correct"] += 1
            
            results["total"] += 1
            
        except Exception as e:
            print(f"Error: {e}")
            results["total"] += 1
    
    return results


def print_results(results: dict):
    """Imprime los resultados."""
    total = results["total"]
    correct = results["correct"]
    accuracy = correct / total if total > 0 else 0
    
    print(f"\nAccuracy global: {accuracy:.1%} ({correct}/{total})")
    print("\nPor clase:")
    print(f"  {'Clase':<22} {'Precisión':<10} {'Muestra'}")
    print(f"  {'-'*50}")
    
    sorted_classes = sorted(
        results["by_class"].items(),
        key=lambda x: x[1]["correct"] / x[1]["total"] if x[1]["total"] > 0 else 0
    )
    
    for cls, stats in sorted_classes:
        prec = stats["correct"] / stats["total"] if stats["total"] > 0 else 0
        print(f"  {cls:<22} {prec:>6.1%}       {stats['total']}")


def main():
    print("=" * 60)
    print("LAYA FTTH EVALUATION")
    print("=" * 60)
    
    # Cargar modelo
    print("\n📦 Cargando modelo Laya...")
    router = Router(default="multilingual")
    
    # Evaluar en train
    print("\n📊 Evaluando en train set...")
    train_data = load_dataset("dataset/laya-ftth/v3/train/train/laya-format.jsonl")
    print(f"   Muestra: {len(train_data)} eventos")
    
    train_results = evaluate_laya(router, train_data)
    print("\n### Train Results")
    print_results(train_results)
    
    # Evaluar en test
    print("\n📊 Evaluando en test set...")
    test_data = load_dataset("dataset/laya-ftth/v3/train/test/laya-format.jsonl")
    print(f"   Muestra: {len(test_data)} eventos")
    
    test_results = evaluate_laya(router, test_data)
    print("\n### Test Results")
    print_results(test_results)
    
    # Resumen
    print("\n" + "=" * 60)
    print("RESUMEN DE NECESIDADES DE FINE-TUNING")
    print("=" * 60)
    
    classes_needing_ft = []
    for cls, stats in test_results["by_class"].items():
        prec = stats["correct"] / stats["total"] if stats["total"] > 0 else 0
        if prec < 0.7:
            classes_needing_ft.append((cls, prec, stats["total"]))
    
    if classes_needing_ft:
        print("\n⚠️  Clases que necesitan fine-tuning (precisión < 70%):")
        for cls, prec, n in sorted(classes_needing_ft, key=lambda x: x[1]):
            print(f"   - {cls:<22}: {prec:.1%} (n={n})")
    else:
        print("\n✅ Todas las clases tienen precisión >= 70%")


if __name__ == "__main__":
    main()
