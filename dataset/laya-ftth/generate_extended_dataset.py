#!/usr/bin/env python3
"""
Generador de dataset FTTH extendido para fine-tuning.

Genera más ejemplos variando los parámetros de los casos reales
para tener un dataset más robusto.
"""

import argparse
import json
import random
from dataclasses import dataclass
from typing import Optional

# ── Casos base reales ──────────────────────────────────────────────────────

@dataclass
class RealCase:
    source: str
    description: str
    device_kinds: list[str]
    alarm_types: list[str]
    symptoms: list[str]
    root_cause: str
    scope: str
    severity: str

REAL_CASES = [
    # OPTICAL_FAULT - Cortes de fibra
    RealCase("Huawei", "Feeder fiber broken - LOS alarm",
        ["OLT", "PON_PORT"], ["LOS", "PON-LOS", "0x2e11a001"],
        ["All ONUs report LOS simultaneously", "Complete service loss"],
        "Feeder fiber is broken", "PON", "CRITICAL"),
    
    RealCase("Huawei", "Distribution fiber broken",
        ["ONU"], ["LOS", "LOSS_OF_SIGNAL"],
        ["Single ONT offline", "Other ONTs normal"],
        "Distribution fiber damaged", "ONU", "HIGH"),
    
    RealCase("EXFO", "Macro bend in distribution fiber",
        ["ONU"], ["MACRO_BEND", "EXCESS_LOSS", "DEGRADED_SIGNAL"],
        ["One branch affected", "4dB excess loss"],
        "Macro bend from improper fiber handling", "PON", "MEDIUM"),
    
    RealCase("Viavi", "Connector failure at splice point",
        ["ONU"], ["LOS", "CONNECTOR_FAULT"],
        ["Intermittent LOS", "RX power fluctuating"],
        "Failed fiber connector", "PON", "HIGH"),
    
    # MASS_OUTAGE - Outages masivos
    RealCase("NetLink Trust", "Third party cut multiple fibers",
        ["PON_PORT"], ["MASS_OUTAGE", "MULTIPLE_ONU_OFFLINE"],
        ["2000 connections affected", "Multiple ISPs impacted"],
        "Third party contractor cut fibers", "PON", "CRITICAL"),
    
    RealCase("Yantai Unicom", "Traffic accident broke cables",
        ["PON_PORT"], ["FIBER_CUT", "MULTIPLE_CABLE_BREAK"],
        ["11 poles knocked down", "400+ users offline"],
        "Traffic accident damaged infrastructure", "PON", "CRITICAL"),
    
    RealCase("PT ICON+", "Frequent rural outages",
        ["PON_PORT"], ["SERVICE_DISRUPTION", "INTERMITTENT_OUTAGE"],
        ["Repeated outages in area", "Customer complaints"],
        "Poor infrastructure", "PON", "MEDIUM"),
    
    # POWER_FAULT - Fallas de energía
    RealCase("Telecomate", "ONT dying gasp",
        ["ONU"], ["DYING_GASP", "POWER_ALARM"],
        ["ONT offline suddenly", "Power failure at premises"],
        "Customer power outage", "ONU", "HIGH"),
    
    RealCase("Huawei", "CTO battery depleted",
        ["CTO"], ["CTO_POWER_LOSS", "BATTERY_LOW"],
        ["Multiple downstream ONUs offline", "Battery backup depleted"],
        "Prolonged power outage at cabinet", "CTO", "HIGH"),
    
    RealCase("Common", "Power supply failure at node",
        ["OLT"], ["POWER_SUPPLY_ALARM", "EQUIPMENT_DOWN"],
        ["Multiple PONs affected", "Equipment offline"],
        "Power supply failure", "OLT", "CRITICAL"),
    
    # DEVICE_FAULT - Fallas de equipos
    RealCase("Huawei", "OLT board failure",
        ["OLT"], ["BOARD_FAILURE", "MULTIPLE_PON_DOWN"],
        ["All PONs on board affected", "Hardware failure"],
        "OLT board malfunction", "OLT", "CRITICAL"),
    
    RealCase("Huawei", "OLT temperature critical",
        ["OLT"], ["HIGH_TEMPERATURE", "THERMAL_SHUTDOWN"],
        ["Temperature exceeded threshold", "Fan degraded"],
        "Cooling system failure", "OLT", "HIGH"),
    
    RealCase("Viavi", "ONT hardware failure",
        ["ONU"], ["ONT_FAULT", "HARDWARE_ERROR"],
        ["Single ONT not responding", "Power on but no service"],
        "ONT hardware malfunction", "ONU", "MEDIUM"),
    
    RealCase("Huawei", "PON port failure",
        ["PON_PORT"], ["PORT_FAILURE", "PON_PORT_DOWN"],
        ["All ONUs on port affected", "Port offline"],
        "PON optics failure", "PON", "HIGH"),
    
    # UPLINK_FAULT - Fallas de uplink
    RealCase("Common", "Uplink port down",
        ["OLT"], ["UPLINK_DOWN", "PORT_FAILURE"],
        ["Primary uplink offline", "Failover activated"],
        "Uplink cable or port failure", "UPLINK", "CRITICAL"),
    
    RealCase("Common", "Aggregation switch failure",
        ["OLT"], ["AGGREGATION_DOWN", "MULTIPLE_UPLINK_DOWN"],
        ["Multiple uplinks affected", "Service degraded"],
        "Aggregation switch failure", "UPLINK", "CRITICAL"),
    
    # CONGESTION - Congestión
    RealCase("Common", "Peak hour congestion",
        ["OLT"], ["CONGESTION", "HIGH_UTILIZATION"],
        ["Bandwidth > 80%", "Slow speeds during peak"],
        "Insufficient uplink capacity", "UPLINK", "MEDIUM"),
    
    RealCase("Common", "Traffic storm",
        ["OLT"], ["TRAFFIC_ANOMALY", "CONGESTION"],
        ["Sudden traffic spike", "Buffer overflow"],
        "DDoS or traffic anomaly", "OLT", "HIGH"),
    
    # OPTICAL_DEGRADATION - Degradación
    RealCase("Huawei", "Slow signal degradation",
        ["ONU"], ["LOW_RX", "RX_WARNING", "DEGRADED_SIGNAL"],
        ["RX power trending down", "Still operational"],
        "Fiber aging or contamination", "ONU", "LOW"),
    
    RealCase("EXFO", "Temperature effect on fiber",
        ["ONU"], ["RX_DEGRADATION", "TEMPERATURE_EFFECT"],
        ["RX varies with temperature", "Gradual decline"],
        "Thermal effect on fiber", "PON", "LOW"),
    
    RealCase("Viavi", "Bending loss increase",
        ["ONU"], ["BENDING_LOSS", "RX_WARNING"],
        ["Increased attenuation", "Problem in closure"],
        "Micro/macro bends", "ONU", "LOW"),
    
    # SPLITTER issues
    RealCase("Viavi", "Splitter internal damage",
        ["SPLITTER"], ["SPLITTER_FAULT", "PARTIAL_OUTAGE"],
        ["Some ONUs affected", "Others degraded"],
        "Splitter internal failure", "SPLITTER", "HIGH"),
    
    RealCase("Viavi", "1x32 splitter with one branch down",
        ["SPLITTER"], ["SPLITTER_BRANCH_DOWN"],
        ["Single branch affected", "Other 31 branches normal"],
        "Branch fiber or connector issue", "SPLITTER", "MEDIUM"),
    
    # NORMAL
    RealCase("Routine", "Normal operation",
        ["ONU", "OLT"], ["NONE", "HEARTBEAT"],
        ["ONT online", "Normal RX power", "All services working"],
        "Normal operation", "NORMAL", "INFO"),
    
    RealCase("Routine", "Scheduled maintenance",
        ["OLT"], ["MAINTENANCE", "PLANNED_OUTAGE"],
        ["Announced outage", "Recovery after window"],
        "Planned maintenance", "OLT", "LOW"),
    
    # UNKNOWN
    RealCase("Unknown", "Non-standard alarm",
        ["UNKNOWN"], ["UNKNOWN_ALARM", "VENDOR_SPECIFIC"],
        ["Unrecognized code", "No mapping available"],
        "Unknown cause", "UNKNOWN", "INFO"),
    
    RealCase("Unknown", "Ambiguous signal",
        ["PON_PORT"], ["AMBIGUOUS", "CLEAR_ALARM"],
        ["Cannot determine cause", "Insufficient data"],
        "Ambiguous evidence", "UNKNOWN", "INFO"),
]


# ── Templates de texto ────────────────────────────────────────────────────────

def generate_text(case: RealCase, variation: int) -> str:
    """Genera texto de evento variando parámetros."""
    
    olt_names = [f"OLT-{n}" for n in ["Core", "Access", "Norte", "Sur", "Este", "Oeste", "Centro"]]
    onu_ids = [f"ONU-{random.randint(100, 9999):04d}" for _ in range(10)]
    pon_ids = [f"0/{random.randint(0,4)}/{random.randint(0,15)}" for _ in range(5)]
    vendors = ["Huawei", "Nokia", "ZTE"]
    
    olt = random.choice(olt_names)
    onu = random.choice(onu_ids)
    pon = random.choice(pon_ids)
    vendor = random.choice(vendors)
    affected = random.randint(4, 64)
    rx = random.uniform(-28, -18)
    temp = random.randint(35, 85)
    util = random.randint(75, 99)
    
    templates = [
        f"{case.device_kinds[0]} reports {case.alarm_types[0]}. {case.symptoms[0]}.",
        f"[{vendor}] {olt} detected {case.alarm_types[0]}. {case.symptoms[0]}.",
        f"Alert: {case.device_kinds[0]} {case.alarm_types[0]}. {case.symptoms[0]}. {case.root_cause[:40]}.",
        f"{pon} {case.device_kinds[0].lower()}: {case.alarm_types[0]}. {affected} {'ONUs' if 'ONUs' in case.symptoms[0] else 'units'} affected.",
    ]
    
    return random.choice(templates)


def generate_event(case: RealCase, event_id: int, variation: int) -> dict:
    """Genera un evento completo."""
    
    event_class_map = {
        "CRITICAL": "CRITICAL",
        "HIGH": "HIGH",
        "MEDIUM": "MEDIUM",
        "LOW": "LOW",
        "INFO": "INFO",
    }
    
    scope_to_probable = {
        "PON": "PON",
        "ONU": "ONU", 
        "OLT": "OLT",
        "CTO": "CTO",
        "UPLINK": "UPLINK",
        "NORMAL": "NORMAL",
        "UNKNOWN": "UNKNOWN",
        "SPLITTER": "SPLITTER",
    }
    
    event_class = case.scope
    if case.scope == "NORMAL":
        event_class = "NORMAL"
    elif "FIBER" in case.root_cause or "FEEDER" in case.root_cause or "DISTRIBUTION" in case.root_cause:
        event_class = "OPTICAL_FAULT"
    elif "POWER" in case.root_cause or "BATTERY" in case.root_cause or "POWER" in case.alarm_types[0]:
        event_class = "POWER_FAULT"
    elif "BOARD" in case.root_cause or "HARDWARE" in case.root_cause or "PORT" in case.root_cause:
        event_class = "DEVICE_FAULT"
    elif "UPLINK" in case.scope or "AGGREGATION" in case.root_cause:
        event_class = "UPLINK_FAULT"
    elif "Congestion" in case.severity or "TRAFFIC" in case.root_cause:
        event_class = "CONGESTION"
    elif "affected" in case.symptoms[0].lower() and (case.scope == "PON" or case.severity == "CRITICAL"):
        event_class = "MASS_OUTAGE"
    elif "DEGRAD" in case.root_cause or "AGING" in case.root_cause:
        event_class = "OPTICAL_DEGRADATION"
    elif "SPLITTER" in case.scope or "SPLITTER" in case.root_cause:
        event_class = "OPTICAL_FAULT"
    elif case.severity == "INFO" and case.scope == "NORMAL":
        event_class = "NORMAL"
    else:
        event_class = "UNKNOWN"
    
    severity = case.severity
    requires_invest = severity in ["HIGH", "CRITICAL", "MEDIUM"]
    
    return {
        "id": f"ftth-ext-{event_id:05d}",
        "event": {
            "eventId": f"ftth-ext-{event_id:05d}",
            "source": random.choice(["snmp", "smartolt", "syslog", "nms"]),
            "vendor": random.choice(["Huawei", "Nokia", "ZTE"]),
            "deviceKind": case.device_kinds[0],
            "deviceId": f"{case.device_kinds[0]}-{random.randint(100, 9999)}",
            "alarmType": random.choice(case.alarm_types),
            "rawSummary": generate_text(case, variation),
        },
        "label": {
            "eventClass": event_class,
            "severity": severity,
            "probableScope": scope_to_probable.get(case.scope, "UNKNOWN"),
            "requiresInvestigation": requires_invest,
        },
        "metadata": {
            "source": case.source,
            "case": case.description,
            "rootCause": case.root_cause,
            "variation": variation,
        }
    }


def main():
    parser = argparse.ArgumentParser(description="Generador de dataset extendido")
    parser.add_argument("--count", type=int, default=500, help="Número de ejemplos")
    parser.add_argument("--output", type=str, default="v3/train/extended.jsonl")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    
    random.seed(args.seed)
    
    print(f"Generando {args.count} eventos extendidos...")
    
    records = []
    for i in range(args.count):
        case = random.choice(REAL_CASES)
        record = generate_event(case, i + 1, i)
        records.append(record)
    
    # Mezclar
    random.shuffle(records)
    
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
