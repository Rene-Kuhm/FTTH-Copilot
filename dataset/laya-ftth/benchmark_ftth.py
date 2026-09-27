#!/usr/bin/env python3
"""
Benchmark del modelo Laya base vs fine-tuned.

Este script compara el rendimiento del modelo genérico contra
el modelo fine-tuned en el dataset FTTH.

Uso:
    python3 benchmark_ftth.py \
        --dataset v2/test/laya-training.jsonl \
        --model_base convaiinnovations/laya-multilingual \
        --model_finetuned ./ftth-laya-v1 \
        --output benchmark_results.json
"""

import argparse
import json
import random
import time
from collections import Counter
from pathlib import Path

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
    "severity": {
        "type": "choice",
        "instructions": "Estimate operational severity.",
        "criteria": {
            "INFO": "Informational only",
            "LOW": "Minor impact",
            "MEDIUM": "Service degradation requiring attention",
            "HIGH": "Significant customer impact",
            "CRITICAL": "Large-scale or infrastructure-critical impact",
        },
    },
    "requires_investigation": {
        "type": "noul",
        "instructions": "Does this event require deeper diagnostic investigation?",
    },
}


def load_dataset(path: str) -> list[dict]:
    """Carga el dataset de evaluación."""
    records = []
    with open(path) as f:
        for line in f:
            records.append(json.loads(line))
    return records


def evaluate_router(
    router: Router,
    dataset: list[dict],
    name: str,
) -> dict:
    """Evalúa un router Laya en el dataset."""
    print(f"\n📊 Evaluando {name}...")
    
    correct = 0
    total = 0
    class_stats = {}
    latencies = []
    
    for i, record in enumerate(dataset):
        input_text = record["input"]
        true_class = record["answers"].get("event_class", {}).get("choice", "UNKNOWN")
        
        if not true_class:
            continue
        
        try:
            start = time.time()
            decisions = router.decide(state=input_text, questions=QUESTIONS)
            latency = (time.time() - start) * 1000
            latencies.append(latency)
            
            pred_class = decisions.get("event_class", {}).get("choice", "UNKNOWN")
            
            is_correct = pred_class == true_class
            if is_correct:
                correct += 1
            total += 1
            
            # Stats por clase
            if true_class not in class_stats:
                class_stats[true_class] = {"correct": 0, "total": 0}
            class_stats[true_class]["total"] += 1
            if is_correct:
                class_stats[true_class]["correct"] += 1
            
            if (i + 1) % 10 == 0:
                print(f"   Progreso: {i+1}/{len(dataset)}")
                
        except Exception as e:
            print(f"   ⚠️  Error en {i}: {e}")
            total += 1
    
    accuracy = correct / total if total > 0 else 0
    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    p95_latency = sorted(latencies)[int(len(latencies) * 0.95)] if latencies else 0
    
    return {
        "name": name,
        "accuracy": accuracy,
        "correct": correct,
        "total": total,
        "avg_latency_ms": avg_latency,
        "p95_latency_ms": p95_latency,
        "class_stats": class_stats,
    }


def print_report(results: list[dict]):
    """Imprime el reporte de benchmark."""
    print("\n" + "=" * 70)
    print("BENCHMARK RESULTS")
    print("=" * 70)
    
    for result in results:
        print(f"\n### {result['name']}")
        print(f"   Accuracy: {result['accuracy']*100:.1f}% ({result['correct']}/{result['total']})")
        print(f"   Avg latency: {result['avg_latency_ms']:.0f}ms")
        print(f"   P95 latency: {result['p95_latency_ms']:.0f}ms")
        
        print("\n   Por clase:")
        print(f"   {'Clase':<22} {'Precisión':<10} {'N'}")
        print(f"   {'-'*45}")
        for cls in sorted(result["class_stats"].keys()):
            stats = result["class_stats"][cls]
            prec = stats["correct"] / stats["total"] if stats["total"] > 0 else 0
            print(f"   {cls:<22} {prec*100:>6.1f}%   {stats['total']}")
    
    # Comparación
    if len(results) >= 2:
        print("\n" + "=" * 70)
        print("COMPARACIÓN")
        print("=" * 70)
        
        base = results[0]
        compare = results[1]
        
        acc_diff = (compare["accuracy"] - base["accuracy"]) * 100
        print(f"\nAccuracy: {base['accuracy']*100:.1f}% → {compare['accuracy']*100:.1f}% ({acc_diff:+.1f}%)")
        
        # Por clase
        print("\nMejora por clase:")
        improved = []
        degraded = []
        for cls in set(base["class_stats"].keys()) | set(compare["class_stats"].keys()):
            base_prec = base["class_stats"].get(cls, {"correct": 0, "total": 0})
            comp_prec = compare["class_stats"].get(cls, {"correct": 0, "total": 0})
            
            base_p = base_prec["correct"] / base_prec["total"] if base_prec["total"] > 0 else 0
            comp_p = comp_prec["correct"] / comp_prec["total"] if comp_prec["total"] > 0 else 0
            
            diff = (comp_p - base_p) * 100
            if diff > 0:
                improved.append((cls, diff))
            elif diff < 0:
                degraded.append((cls, diff))
        
        print("\n  ✅ Mejorado:")
        for cls, diff in sorted(improved, key=lambda x: -x[1])[:5]:
            print(f"     {cls:<22}: +{diff:.1f}%")
        
        print("\n  ❌ Empeorado:")
        for cls, diff in sorted(degraded, key=lambda x: x[1])[:5]:
            print(f"     {cls:<22}: {diff:.1f}%")


def main():
    parser = argparse.ArgumentParser(description="Benchmark Laya FTTH")
    parser.add_argument("--dataset", type=str, required=True, help="Dataset JSONL")
    parser.add_argument("--model_base", type=str, default="convaiinnovations/laya-multilingual")
    parser.add_argument("--model_finetuned", type=str, help="Modelo fine-tuned (local path)")
    parser.add_argument("--output", type=str, help="Archivo de resultados JSON")
    parser.add_argument("--sample", type=int, help="Usar muestra del dataset")
    args = parser.parse_args()
    
    # Cargar dataset
    print(f"📂 Cargando dataset: {args.dataset}")
    dataset = load_dataset(args.dataset)
    if args.sample:
        random.seed(42)
        dataset = random.sample(dataset, min(args.sample, len(dataset)))
    print(f"   Registros: {len(dataset)}")
    
    results = []
    
    # Evaluar modelo base
    print("\n📦 Cargando modelo base...")
    base_router = Router(default="multilingual")
    results.append(evaluate_router(base_router, dataset, "Base (laya-multilingual)"))
    
    # Evaluar modelo fine-tuned si existe
    if args.model_finetuned and Path(args.model_finetuned).exists():
        print("\n📦 Cargando modelo fine-tuned...")
        ft_router = Router(default=args.model_finetuned)
        results.append(evaluate_router(ft_router, dataset, f"Fine-tuned ({args.model_finetuned})"))
    else:
        print("\n⚠️  Modelo fine-tuned no especificado o no existe")
    
    # Imprimir reporte
    print_report(results)
    
    # Guardar resultados
    if args.output:
        with open(args.output, "w") as f:
            json.dump(results, f, indent=2, default=str)
        print(f"\n💾 Resultados guardados: {args.output}")


if __name__ == "__main__":
    main()
