#!/usr/bin/env python3
"""
Generador de dataset FTTH balanceado para fine-tuning.

Genera un dataset con distribución más balanceada entre clases.
"""

import argparse
import json
import random
from dataclasses import dataclass
from typing import Optional


@dataclass
class CaseTemplate:
    name: str
    event_class: str
    severity: str
    probable_scope: str
    templates: list[str]
    scopes: list[str]


# Templates por clase
CASE_TEMPLATES = [
    # OPTICAL_FAULT
    CaseTemplate(
        name="Fiber cut - PON",
        event_class="OPTICAL_FAULT",
        severity="CRITICAL",
        probable_scope="PON",
        scopes=["PON"],
        templates=[
            "All ONUs on PON {pon} report LOS. Feeder fiber broken.",
            "Complete outage on PON {pon}. Fiber cut detected.",
            "{affected} ONUs offline on PON {pon}. Upstream fiber damaged.",
        ]
    ),
    CaseTemplate(
        name="ONU LOS",
        event_class="OPTICAL_FAULT",
        severity="MEDIUM",
        probable_scope="ONU",
        scopes=["ONU"],
        templates=[
            "ONU-{onu_id} reports LOS. RX power dropped to {rx} dBm.",
            "Single ONT offline: ONU-{onu_id}. Distribution fiber issue.",
            "ONT failure on ONU-{onu_id}. Signal loss detected.",
        ]
    ),
    CaseTemplate(
        name="Splitter failure",
        event_class="OPTICAL_FAULT",
        severity="HIGH",
        probable_scope="SPLITTER",
        scopes=["SPLITTER"],
        templates=[
            "Splitter fault on PON {pon}. {affected} ONUs affected.",
            "1x32 splitter showing partial outage. Internal damage suspected.",
            "Optical splitter failure. {affected} of 32 branches down.",
        ]
    ),
    
    # MASS_OUTAGE
    CaseTemplate(
        name="Mass outage - fiber cut",
        event_class="MASS_OUTAGE",
        severity="CRITICAL",
        probable_scope="PON",
        scopes=["PON"],
        templates=[
            "Mass outage: {affected} ONUs offline on PON {pon}. Common upstream cause.",
            "Multiple fiber cables cut. {affected} connections affected.",
            "Large-scale outage: {pon} PON affected. {affected} users offline.",
        ]
    ),
    CaseTemplate(
        name="PON port failure",
        event_class="MASS_OUTAGE",
        severity="HIGH",
        probable_scope="PON",
        scopes=["PON"],
        templates=[
            "PON {pon} port failure. All {affected} ONUs offline.",
            "Port-level outage: PON {pon}. Equipment failure suspected.",
            "Complete PON outage: {affected} ONUs affected simultaneously.",
        ]
    ),
    
    # POWER_FAULT
    CaseTemplate(
        name="Dying gasp",
        event_class="POWER_FAULT",
        severity="HIGH",
        probable_scope="ONU",
        scopes=["ONU"],
        templates=[
            "ONU-{onu_id} dying gasp detected. Customer power failure.",
            "ONT power alarm: ONU-{onu_id}. UPS depleted at premises.",
            "Dying gasp from ONU-{onu_id}. Power outage at customer site.",
        ]
    ),
    CaseTemplate(
        name="CTO power loss",
        event_class="POWER_FAULT",
        severity="HIGH",
        probable_scope="CTO",
        scopes=["CTO"],
        templates=[
            "CTO power failure. {affected} downstream ONUs offline.",
            "Cabinet battery depleted. Multiple customers affected.",
            "Power outage at distribution cabinet. {affected} users offline.",
        ]
    ),
    
    # DEVICE_FAULT
    CaseTemplate(
        name="OLT board failure",
        event_class="DEVICE_FAULT",
        severity="CRITICAL",
        probable_scope="OLT",
        scopes=["OLT"],
        templates=[
            "OLT-{olt_id} board failure. Multiple PONs affected.",
            "Hardware fault on OLT-{olt_id}. Board replacement required.",
            "OLT equipment failure. All PONs on affected board down.",
        ]
    ),
    CaseTemplate(
        name="OLT temperature",
        event_class="DEVICE_FAULT",
        severity="HIGH",
        probable_scope="OLT",
        scopes=["OLT"],
        templates=[
            "OLT-{olt_id} temperature at {temp}°C. Threshold exceeded.",
            "Thermal alarm: OLT-{olt_id}. Cooling system degraded.",
            "OLT thermal shutdown warning. Temperature {temp}°C.",
        ]
    ),
    CaseTemplate(
        name="ONT hardware",
        event_class="DEVICE_FAULT",
        severity="MEDIUM",
        probable_scope="ONU",
        scopes=["ONU"],
        templates=[
            "ONU-{onu_id} hardware failure. ONT not responding.",
            "ONT malfunction: ONU-{onu_id}. Equipment replacement needed.",
            "Optical transceiver fault on ONU-{onu_id}.",
        ]
    ),
    
    # UPLINK_FAULT
    CaseTemplate(
        name="Uplink down",
        event_class="UPLINK_FAULT",
        severity="CRITICAL",
        probable_scope="UPLINK",
        scopes=["UPLINK"],
        templates=[
            "Uplink port {port} down on OLT-{olt_id}. Failover active.",
            "Aggregation link failure. Primary uplink offline.",
            "OLT-{olt_id} lost uplink connectivity. Service degraded.",
        ]
    ),
    CaseTemplate(
        name="Aggregation failure",
        event_class="UPLINK_FAULT",
        severity="CRITICAL",
        probable_scope="UPLINK",
        scopes=["UPLINK"],
        templates=[
            "Aggregation switch failure. Multiple uplinks down.",
            "Core connectivity issue. OLT-{olt_id} isolated.",
            "Network core failure. Aggregation layer affected.",
        ]
    ),
    
    # CONGESTION
    CaseTemplate(
        name="Uplink congestion",
        event_class="CONGESTION",
        severity="MEDIUM",
        probable_scope="UPLINK",
        scopes=["UPLINK"],
        templates=[
            "Uplink utilization at {util}% on OLT-{olt_id}. Congestion alert.",
            "Bandwidth saturation: {util}% utilization. Peak hours impact.",
            "High traffic load on OLT-{olt_id}. {util}% uplink used.",
        ]
    ),
    CaseTemplate(
        name="Traffic storm",
        event_class="CONGESTION",
        severity="HIGH",
        probable_scope="UPLINK",
        scopes=["UPLINK"],
        templates=[
            "Traffic anomaly detected. Sudden spike in traffic.",
            "DDoS suspected. Abnormal traffic pattern on OLT-{olt_id}.",
            "Buffer overflow. Traffic storm on aggregation link.",
        ]
    ),
    
    # OPTICAL_DEGRADATION
    CaseTemplate(
        name="RX degradation",
        event_class="OPTICAL_DEGRADATION",
        severity="LOW",
        probable_scope="ONU",
        scopes=["ONU"],
        templates=[
            "ONU-{onu_id} RX power declining: {rx} dBm. Trend: {trend} dBm/day.",
            "Slow signal degradation on ONU-{onu_id}. Still operational.",
            "Optical attenuation increase on ONU-{onu_id}. Monitoring.",
        ]
    ),
    CaseTemplate(
        name="Temperature effect",
        event_class="OPTICAL_DEGRADATION",
        severity="LOW",
        probable_scope="PON",
        scopes=["PON"],
        templates=[
            "Temperature-dependent signal loss on PON {pon}.",
            "RX variations with ambient temperature. {rx} dBm recorded.",
            "Thermal effect on fiber. Signal slowly degrading.",
        ]
    ),
    
    # NORMAL
    CaseTemplate(
        name="Normal operation",
        event_class="NORMAL",
        severity="INFO",
        probable_scope="NORMAL",
        scopes=["ONU", "OLT"],
        templates=[
            "Routine check: ONT online. RX {rx} dBm. All services operational.",
            "Health check OK: OLT-{olt_id}. No alarms active.",
            "Normal operation. {rx} dBm RX. No issues detected.",
        ]
    ),
    
    # UNKNOWN
    CaseTemplate(
        name="Unknown alarm",
        event_class="UNKNOWN",
        severity="INFO",
        probable_scope="UNKNOWN",
        scopes=["UNKNOWN"],
        templates=[
            "Unknown alarm code {code} from device. Manual investigation required.",
            "Non-standard event received. Cannot classify automatically.",
            "Ambiguous signal on PON {pon}. Insufficient data for diagnosis.",
        ]
    ),
]


def generate_value(template: str, template_obj: CaseTemplate) -> str:
    """Reemplaza placeholders en el template."""
    replacements = {
        "{pon}": f"0/{random.randint(0,4)}/{random.randint(0,15)}",
        "{onu_id}": f"{random.randint(100, 9999):04d}",
        "{olt_id}": random.choice(["Core-01", "Access-01", "Norte-01", "Sur-01"]),
        "{affected}": str(random.randint(8, 128)),
        "{rx}": f"{random.uniform(-28, -20):.1f}",
        "{temp}": str(random.randint(60, 85)),
        "{util}": str(random.randint(80, 99)),
        "{port}": f"GigabitEthernet{random.randint(1,4)}/{random.randint(0,3)}/{random.randint(0,31)}",
        "{trend}": f"-{random.uniform(0.1, 1.5):.2f}",
        "{code}": f"0x{random.randint(0, 255):02X}{random.randint(0, 255):02X}",
    }
    
    result = template
    for placeholder, value in replacements.items():
        result = result.replace(placeholder, value)
    return result


def generate_balanced_dataset(count: int, seed: int = 42) -> list[dict]:
    """Genera dataset balanceado."""
    random.seed(seed)
    
    records = []
    examples_per_class = count // len(CASE_TEMPLATES)
    
    for template_obj in CASE_TEMPLATES:
        for i in range(examples_per_class):
            template = random.choice(template_obj.templates)
            summary = generate_value(template, template_obj)
            device_kind = random.choice(template_obj.scopes)
            
            record = {
                "id": f"ftth-balanced-{len(records):05d}",
                "event": {
                    "eventId": f"ftth-balanced-{len(records):05d}",
                    "source": random.choice(["snmp", "smartolt", "syslog", "nms"]),
                    "vendor": random.choice(["Huawei", "Nokia", "ZTE"]),
                    "deviceKind": device_kind,
                    "deviceId": f"{device_kind}-{random.randint(100, 9999)}",
                    "alarmType": template_obj.name.split()[0].upper(),
                    "rawSummary": summary,
                },
                "label": {
                    "eventClass": template_obj.event_class,
                    "severity": template_obj.severity,
                    "probableScope": template_obj.probable_scope,
                    "requiresInvestigation": template_obj.severity in ["HIGH", "CRITICAL", "MEDIUM"],
                },
                "metadata": {
                    "source": "balanced_synthetic",
                    "template": template_obj.name,
                }
            }
            records.append(record)
    
    random.shuffle(records)
    return records


def main():
    parser = argparse.ArgumentParser(description="Generador de dataset balanceado")
    parser.add_argument("--count", type=int, default=180, help="Número de ejemplos")
    parser.add_argument("--output", type=str, default="v3/train/balanced.jsonl")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    
    print(f"Generando {args.count} eventos balanceados...")
    records = generate_balanced_dataset(args.count, args.seed)
    
    # Guardar
    import os
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    
    with open(args.output, "w") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    
    # Stats
    from collections import Counter
    class_counts = Counter(r["label"]["eventClass"] for r in records)
    
    print(f"\n✅ Generados: {len(records)}")
    print(f"   Archivo: {args.output}")
    print(f"\n📊 Distribución:")
    for ec, count in sorted(class_counts.items()):
        print(f"   {ec:<22}: {count:4d} ({count/len(records)*100:5.1f}%)")


if __name__ == "__main__":
    main()
