#!/usr/bin/env python3
"""
Convertidor de dataset FTTH al formato de entrenamiento de Laya.

Este script transforma el dataset ftth-real-events.jsonl al formato
que Laya espera para fine-tuning.

Uso:
    python3 prepare_ftth_dataset.py --input v2/train/ftth-real-events.jsonl --output v2/ftth-training.jsonl
"""

import argparse
import json
import sys
from pathlib import Path

# ── Mapeo de clases ──────────────────────────────────────────────────────────

EVENT_CLASS_MAPPING = {
    "NORMAL": "NORMAL",
    "OPTICAL_DEGRADATION": "OPTICAL_DEGRADATION",
    "OPTICAL_FAULT": "OPTICAL_FAULT",
    "POWER_FAULT": "POWER_FAULT",
    "DEVICE_FAULT": "DEVICE_FAULT",
    "UPLINK_FAULT": "UPLINK_FAULT",
    "CONGESTION": "CONGESTION",
    "MASS_OUTAGE": "MASS_OUTAGE",
    "SECURITY_EVENT": "SECURITY_EVENT",
    "UNKNOWN": "UNKNOWN",
}

SEVERITY_MAPPING = {
    "INFO": "INFO",
    "LOW": "LOW",
    "MEDIUM": "MEDIUM",
    "HIGH": "HIGH",
    "CRITICAL": "CRITICAL",
}

# ── Templates de preguntas para fine-tuning ─────────────────────────────────

BASE_QUESTIONS = {
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
- SECURITY_EVENT: Suspected security incident
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
            "SECURITY_EVENT": "Security incident suspected",
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
    "probable_scope": {
        "type": "choice",
        "instructions": "Estimate the probable fault scope.",
        "criteria": {
            "ONU": "Individual ONT customer premises",
            "CTO": "Customer terminal equipment or cabinet",
            "SPLITTER": "Optical splitter failure",
            "PON": "PON port or feeder fiber",
            "OLT": "OLT equipment or board",
            "UPLINK": "Aggregation or uplink",
            "POWER": "Power supply issue",
            "UNKNOWN": "Cannot determine",
        },
    },
    "requires_investigation": {
        "type": "noul",
        "instructions": "Does this event require deeper diagnostic investigation?",
    },
}


def convert_to_laya_format(record: dict) -> dict:
    """
    Convierte un registro del dataset FTTH al formato Laya.
    
    Laya espera:
    {
        "input": "texto del evento",
        "questions": {...},
        "answers": {
            "question_name": {
                "type": "choice|noul|score",
                "choice": "valor" | null,
                "score": float | null,
            }
        }
    }
    """
    event = record["event"]
    label = record["label"]
    
    # Texto de entrada
    input_text = event["rawSummary"]
    
    # Agregar contexto adicional si está disponible
    if event.get("deviceKind"):
        input_text = f"[{event['deviceKind']}] {input_text}"
    if event.get("vendor"):
        input_text = f"[{event['vendor']}] {input_text}"
    if event.get("rxPower") is not None:
        input_text = f"{input_text} [RX: {event['rxPower']} dBm]"
    if event.get("affectedOnus") is not None:
        input_text = f"{input_text} [Affected ONUs: {event['affectedOnus']}]"
    
    # Construir respuestas
    answers = {}
    
    # event_class
    if label.get("eventClass"):
        answers["event_class"] = {
            "type": "choice",
            "choice": label["eventClass"],
        }
    
    # severity
    if label.get("severity"):
        answers["severity"] = {
            "type": "choice",
            "choice": label["severity"],
        }
    
    # probable_scope
    if label.get("probableScope"):
        answers["probable_scope"] = {
            "type": "choice",
            "choice": label["probableScope"],
        }
    
    # requires_investigation
    if label.get("requiresInvestigation") is not None:
        answers["requires_investigation"] = {
            "type": "noul",
            "choice": label["requiresInvestigation"],
        }
    
    return {
        "input": input_text,
        "questions": BASE_QUESTIONS,
        "answers": answers,
        "metadata": {
            "event_id": event["eventId"],
            "source": event.get("source"),
            "case_source": record.get("metadata", {}).get("caseSource"),
        },
    }


def split_dataset(
    records: list,
    train_ratio: float = 0.8,
    val_ratio: float = 0.1,
    test_ratio: float = 0.1,
) -> tuple[list, list, list]:
    """Divide el dataset en train/val/test."""
    import random
    
    random.shuffle(records)
    
    n = len(records)
    train_end = int(n * train_ratio)
    val_end = train_end + int(n * val_ratio)
    
    train = records[:train_end]
    val = records[train_end:val_end]
    test = records[val_end:]
    
    return train, val, test


def balance_by_class(
    records: list,
    max_per_class: int = 50,
) -> list:
    """Limita el número de ejemplos por clase para balancear el dataset."""
    from collections import defaultdict
    
    by_class = defaultdict(list)
    for r in records:
        ec = r["label"]["eventClass"]
        by_class[ec].append(r)
    
    balanced = []
    for ec, items in by_class.items():
        balanced.extend(items[:max_per_class])
    
    import random
    random.shuffle(balanced)
    return balanced


def main():
    parser = argparse.ArgumentParser(
        description="Convertir dataset FTTH al formato Laya"
    )
    parser.add_argument(
        "--input",
        type=str,
        required=True,
        help="Archivo JSONL de entrada",
    )
    parser.add_argument(
        "--output",
        type=str,
        required=True,
        help="Archivo JSONL de salida",
    )
    parser.add_argument(
        "--balance",
        action="store_true",
        help="Balancear dataset por clase",
    )
    parser.add_argument(
        "--max-per-class",
        type=int,
        default=100,
        help="Máximo ejemplos por clase",
    )
    parser.add_argument(
        "--split",
        action="store_true",
        help="Dividir en train/val/test",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Semilla random",
    )
    args = parser.parse_args()
    
    import random
    random.seed(args.seed)
    
    # Cargar dataset
    print(f"📂 Cargando dataset: {args.input}")
    records = []
    with open(args.input) as f:
        for line in f:
            records.append(json.loads(line))
    print(f"   Total registros: {len(records)}")
    
    # Balancear si se solicita
    if args.balance:
        print(f"⚖️  Balanceando dataset (max {args.max_per_class}/clase)...")
        records = balance_by_class(records, args.max_per_class)
        print(f"   Después de balancear: {len(records)}")
    
    # Contar por clase
    from collections import Counter
    class_counts = Counter(r["label"]["eventClass"] for r in records)
    print("\n📊 Distribución por clase:")
    for ec, count in sorted(class_counts.items()):
        print(f"   {ec:<22}: {count:3d}")
    
    # Convertir
    print("\n🔄 Convirtiendo al formato Laya...")
    converted = []
    for record in records:
        try:
            laya_record = convert_to_laya_format(record)
            converted.append(laya_record)
        except Exception as e:
            print(f"   ⚠️  Error en {record.get('id', 'unknown')}: {e}")
    
    print(f"   Convertidos: {len(converted)}/{len(records)}")
    
    # Guardar
    if args.split:
        print("\n📦 Dividiendo dataset...")
        train, val, test = split_dataset(converted)
        
        output_path = Path(args.output)
        output_dir = output_path.parent
        
        (output_dir / "train").mkdir(parents=True, exist_ok=True)
        (output_dir / "val").mkdir(parents=True, exist_ok=True)
        (output_dir / "test").mkdir(parents=True, exist_ok=True)
        
        for name, data in [("train", train), ("val", val), ("test", test)]:
            out_file = output_dir / name / f"{output_path.stem}.jsonl"
            with open(out_file, "w") as f:
                for item in data:
                    f.write(json.dumps(item, ensure_ascii=False) + "\n")
            print(f"   {name}: {len(data)} registros → {out_file}")
    else:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            for item in converted:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
        print(f"\n✅ Guardado: {output_path}")
    
    # Resumen
    print("\n" + "=" * 50)
    print("RESUMEN")
    print("=" * 50)
    print(f"Input:  {args.input}")
    print(f"Output: {args.output}")
    print(f"Total:  {len(converted)} registros")
    print("\n📋 Distribución final:")
    final_counts = Counter(r["answers"].get("event_class", {}).get("choice", "N/A") for r in converted)
    for ec, count in sorted(final_counts.items()):
        print(f"   {ec:<22}: {count:3d}")


if __name__ == "__main__":
    main()
