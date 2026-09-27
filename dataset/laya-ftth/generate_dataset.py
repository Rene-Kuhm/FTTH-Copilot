#!/usr/bin/env python3
"""
Generador de dataset sintético FTTH para fine-tuning de Laya.
Produce 100 eventos realistas basados en patrones de red FTTH.

Uso:
    python3 generate_dataset.py [--count 100] [--output ./v1/train]
"""

import argparse
import json
import random
from dataclasses import dataclass, asdict
from typing import Optional

# ── Plantillas de eventos por clase ────────────────────────────────────────

@dataclass
class EventTemplate:
    name: str
    device_kinds: list[str]
    alarm_types: list[str]
    summaries: list[str]
    labels: dict

TEMPLATES = [
    # OPTICAL_FAULT
    EventTemplate(
        name="ONU_LOS",
        device_kinds=["ONU"],
        alarm_types=["LOS", "LOSS_OF_SIGNAL", "SIGNAL_LOSS"],
        summaries=[
            "ONU-{id} reports LOS. RX power dropped from {rx_before} dBm to below threshold (-25 dBm). No power alarm detected.",
            "Loss of signal detected on ONU-{id}. Optical power at {rx} dBm, below operational range.",
            "ONU-{id} went offline with LOS alarm. Previous RX: {rx_before} dBm, current: {rx} dBm.",
        ],
        labels={"eventClass": "OPTICAL_FAULT", "severity": "MEDIUM", "probableScope": "ONU", "requiresInvestigation": True}
    ),
    EventTemplate(
        name="PON_CUT",
        device_kinds=["PON_PORT"],
        alarm_types=["MULTIPLE_ONU_OFFLINE", "PON_ALARM"],
        summaries=[
            "All {count} ONUs on PON {pon} lost signal simultaneously. Common cause suspected: fiber cut or splitter failure.",
            "{count} ONUs on PON {pon} reported LOS within {window} seconds. Pattern indicates upstream fault.",
            "PON {pon} showing complete outage. {count} ONUs offline. RX degradation observed {minutes} minutes before failure.",
        ],
        labels={"eventClass": "MASS_OUTAGE", "severity": "HIGH", "probableScope": "PON", "requiresInvestigation": True}
    ),
    # OPTICAL_DEGRADATION
    EventTemplate(
        name="RX_DEGRADATION",
        device_kinds=["ONU"],
        alarm_types=["LOW_RX", "RX_WARNING", "DEGRADED_SIGNAL"],
        summaries=[
            "ONU-{id} RX power gradually declining: {rx1} → {rx2} → {rx3} dBm over {days} days. Still above threshold but trending down.",
            "Slow signal degradation detected on ONU-{id}. Current RX: {rx} dBm. Trend: {trend} dBm/day.",
            "ONU-{id} showing progressive signal loss. From {rx_before} dBm to {rx} dBm in {days} days.",
        ],
        labels={"eventClass": "OPTICAL_DEGRADATION", "severity": "LOW", "probableScope": "ONU", "requiresInvestigation": True}
    ),
    # POWER_FAULT
    EventTemplate(
        name="DYING_GASP",
        device_kinds=["ONU"],
        alarm_types=["DYING_GASP", "POWER_INTERRUPT", "BATTERY_LOW"],
        summaries=[
            "ONU-{id} reported dying gasp. Power failure detected at customer premises. Expected recovery when power restored.",
            "ONU-{id} power alarm and dying gasp simultaneously. Customer reported outage. No network fault suspected.",
            "Sudden power loss detected at ONU-{id}. Dying gasp pattern confirms customer-side power issue.",
        ],
        labels={"eventClass": "POWER_FAULT", "severity": "HIGH", "probableScope": "ONU", "requiresInvestigation": False}
    ),
    EventTemplate(
        name="CTO_POWER_LOSS",
        device_kinds=["CTO"],
        alarm_types=["CTO_OFFLINE", "CTO_POWER_ALARM"],
        summaries=[
            "CTO-{id} reported power failure. {count} downstream ONUs affected. Battery backup status: {battery}%.",
            "Power outage at CTO-{id}. All {count} ONUs downstream went offline. AC power failure confirmed.",
            "CTO-{id} running on battery ({battery}%). Estimated backup time: {hours} hours.",
        ],
        labels={"eventClass": "POWER_FAULT", "severity": "HIGH", "probableScope": "CTO", "requiresInvestigation": True}
    ),
    # DEVICE_FAULT
    EventTemplate(
        name="OLT_UNREACHABLE",
        device_kinds=["OLT"],
        alarm_types=["DEVICE_UNREACHABLE", "OLT_DOWN", "SNMP_TIMEOUT"],
        summaries=[
            "OLT-{id} not responding to SNMP polls for {minutes} minutes. Last known status: {status}.",
            "Critical: OLT-{id} unreachable from NMS. Last response {minutes} minutes ago. Device may be down.",
            "OLT-{id} SNMP timeout. Management plane unreachable. Total PON outage possible.",
        ],
        labels={"eventClass": "DEVICE_FAULT", "severity": "CRITICAL", "probableScope": "OLT", "requiresInvestigation": True}
    ),
    EventTemplate(
        name="OLT_TEMPERATURE",
        device_kinds=["OLT"],
        alarm_types=["HIGH_TEMPERATURE", "FAN_FAILURE", "THERMAL_ALARM"],
        summaries=[
            "OLT-{id} temperature at {temp}°C. Threshold: {threshold}°C. Fan status: {fan_status}.",
            "Thermal alarm on OLT-{id}. Temperature exceeded {threshold}°C limit. Current: {temp}°C.",
            "OLT-{id} cooling system degraded. Temperature rising. Current: {temp}°C / Limit: {threshold}°C.",
        ],
        labels={"eventClass": "DEVICE_FAULT", "severity": "MEDIUM", "probableScope": "OLT", "requiresInvestigation": True}
    ),
    # UPLINK_FAULT
    EventTemplate(
        name="UPLINK_DOWN",
        device_kinds=["OLT"],
        alarm_types=["UPLINK_DOWN", "AGGREGATION_PORT_DOWN", "ETH_PORT_FAILURE"],
        summaries=[
            "Uplink port {port} on OLT-{id} is down. Redundancy port {backup} is {status}.",
            "Aggregation link failure on OLT-{id}. Primary uplink {port} offline. Failover: {status}.",
            "OLT-{id} lost uplink connectivity on {port}. Traffic being rerouted through backup path.",
        ],
        labels={"eventClass": "UPLINK_FAULT", "severity": "CRITICAL", "probableScope": "UPLINK", "requiresInvestigation": True}
    ),
    # CONGESTION
    EventTemplate(
        name="UPLINK_CONGESTION",
        device_kinds=["OLT"],
        alarm_types=["HIGH_UTILIZATION", "CONGESTION", "BANDWIDTH_ALERT"],
        summaries=[
            "Uplink port {port} on OLT-{id} at {util}% utilization for {minutes} minutes. Threshold: 80%.",
            "Congestion detected on OLT-{id} uplink. Port utilization sustained at {util}%.",
            "Bandwidth alert: OLT-{id} uplink {port} showing {util}% utilization. Peak hours impact.",
        ],
        labels={"eventClass": "CONGESTION", "severity": "MEDIUM", "probableScope": "OLT", "requiresInvestigation": True}
    ),
    # SPLITTER
    EventTemplate(
        name="SPLITTER_SUSPECTED",
        device_kinds=["PON_PORT", "SPLITTER"],
        alarm_types=["PARTIAL_OUTAGE", "INTERMITTENT_LOS", "SPLITTER_ALARM"],
        summaries=[
            "Partial outage on PON {pon}: {affected} of {total} ONUs affected. Remaining {remaining} show degraded signal. Splitter suspected.",
            "{affected} ONUs offline, {degraded} degraded on PON {pon}. Pattern suggests splitter or fiber issue upstream.",
            "PON {pon} showing {affected}/{total} ONUs offline. Others at degraded RX levels. Upstream fiber or splitter fault.",
        ],
        labels={"eventClass": "OPTICAL_FAULT", "severity": "HIGH", "probableScope": "SPLITTER", "requiresInvestigation": True}
    ),
    # NORMAL
    EventTemplate(
        name="NORMAL_POLL",
        device_kinds=["ONU", "OLT"],
        alarm_types=["NONE", "HEARTBEAT", "ROUTINE_POLL"],
        summaries=[
            "Routine poll: ONU-{id} online with normal RX ({rx} dBm). TX: {tx} dBm. Temperature: {temp}°C.",
            "ONU-{id} status check: operational. Signal quality: good. No alarms active.",
            "Periodic telemetry from ONU-{id}: RX {rx} dBm within normal range (-8 to -25 dBm).",
        ],
        labels={"eventClass": "NORMAL", "severity": "INFO", "probableScope": "ONU", "requiresInvestigation": False}
    ),
    # UNKNOWN
    EventTemplate(
        name="UNKNOWN_ALARM",
        device_kinds=["UNKNOWN", "ONU", "OLT"],
        alarm_types=["UNKNOWN_ALARM", "UNRECOGNIZED_CODE", "VENDOR_SPECIFIC"],
        summaries=[
            "Received unrecognized alarm code {code} from {device}. Message: '{message}'",
            "Unknown event from device {id}: type {type}, code {code}. Manual investigation required.",
            "Non-standard alarm received: {message}. Vendor: {vendor}. No mapping to standard classification.",
        ],
        labels={"eventClass": "UNKNOWN", "severity": "INFO", "probableScope": "UNKNOWN", "requiresInvestigation": True}
    ),
]


def generate_event(template: EventTemplate, event_id: int) -> dict:
    """Genera un evento completo a partir de una plantilla."""
    # Seleccionar aleatoriamente
    device_kind = random.choice(template.device_kinds)
    alarm_type = random.choice(template.alarm_types)
    summary_template = random.choice(template.summaries)
    
    # Generar IDs
    onu_id = f"ONU-{random.randint(100, 9999):04d}"
    pon_id = f"0/{random.randint(0, 4)}/{random.randint(0, 15)}"
    olt_id = f"OLT-{random.choice(['Core', 'Access', 'Aggregation', 'Norte', 'Sur', 'Este', 'Oeste'])}-{random.randint(1, 10):02d}"
    cto_id = f"CTO-{random.randint(100, 999)}"
    
    # Generar valores numéricos realistas
    rx_values = [-18.0, -19.5, -20.0, -21.0, -22.0, -23.0, -24.0, -25.0, -26.0, -27.0]
    rx = random.choice(rx_values)
    rx_before = rx - random.uniform(2, 8)
    tx = round(random.uniform(1.5, 4.5), 1)
    temp = random.randint(30, 75)
    temp_threshold = random.choice([60, 70, 75, 80])
    
    # Placeholder replacement
    replacements = {
        "{id}": onu_id if device_kind == "ONU" else olt_id.split("-")[0] + "-" + str(random.randint(1, 20)),
        "{pon}": pon_id,
        "{count}": str(random.randint(4, 32)),
        "{window}": str(random.randint(5, 60)),
        "{minutes}": str(random.randint(1, 60)),
        "{hours}": str(random.randint(2, 8)),
        "{days}": str(random.randint(1, 14)),
        "{rx_before}": f"{rx_before:.1f}",
        "{rx}": f"{rx:.1f}",
        "{rx1}": f"{rx:.1f}",
        "{rx2}": f"{rx - 0.5:.1f}",
        "{rx3}": f"{rx - 1.0:.1f}",
        "{tx}": f"{tx:.1f}",
        "{temp}": str(temp),
        "{threshold}": str(temp_threshold),
        "{fan_status}": random.choice(["normal", "degraded", "failed", "reduced"]),
        "{port}": f"GigabitEthernet{random.randint(1, 4)}/{random.randint(0, 3)}/{random.randint(0, 31)}",
        "{backup}": f"GigabitEthernet{random.randint(1, 4)}/{random.randint(0, 3)}/{random.randint(0, 31)}",
        "{status}": random.choice(["active", "standby", "failed", "unknown"]),
        "{util}": str(random.randint(80, 99)),
        "{total}": str(random.choice([8, 16, 32])),
        "{affected}": str(random.randint(3, 12)),
        "{degraded}": str(random.randint(1, 6)),
        "{remaining}": str(random.randint(4, 20)),
        "{battery}": str(random.randint(10, 100)),
        "{code}": f"0x{random.randint(0, 255):02X}{random.randint(0, 255):02X}",
        "{message}": random.choice([
            "Unknown vendor-specific event",
            "Port status changed",
            "Configuration changed",
            "Interface reset",
            "Module inserted"
        ]),
        "{type}": random.choice(["alarm", "event", "trap", "notification"]),
        "{vendor}": random.choice(["Huawei", "Nokia", "ZTE", "Cisco", "Generic"]),
        "{trend}": f"-{random.uniform(0.1, 1.5):.2f}",
    }
    
    summary = summary_template
    for placeholder, value in replacements.items():
        summary = summary.replace(placeholder, value)
    
    # Generar vendor
    vendor = random.choice(["Huawei", "Nokia", "ZTE", "Huawei", "Nokia"])
    
    # Construir evento
    event = {
        "eventId": f"ftth-train-{event_id:05d}",
        "source": random.choice(["snmp", "smartolt", "syslog", "mikrowisp"]),
        "vendor": vendor if random.random() > 0.2 else None,
        "deviceKind": device_kind,
        "deviceId": onu_id if device_kind == "ONU" else (olt_id if device_kind == "OLT" else pon_id),
        "alarmType": alarm_type,
        "rawSummary": summary,
    }
    
    # Agregar campos opcionales según tipo
    if "RX" in alarm_type or "LOS" in alarm_type or "DEGRAD" in alarm_type:
        event["rxPower"] = round(rx, 1)
    
    if "DYING" in alarm_type or "POWER" in alarm_type:
        event["dyingGasp"] = True
        event["powerAlarm"] = True
    
    if "MULTIPLE" in alarm_type or "MASS" in alarm_type:
        event["affectedOnus"] = random.randint(4, 32)
    
    # Construir registro completo
    record = {
        "id": f"ftth-train-{event_id:05d}",
        "event": event,
        "label": template.labels.copy(),
        "metadata": {
            "generated": True,
            "template": template.name,
            "confidence_override": random.uniform(0.75, 0.98)  # Para calibración
        }
    }
    
    return record


def generate_negation_samples(count: int = 10) -> list[dict]:
    """Genera samples de negación (importante para testing)."""
    negations = [
        ("ONU-342 does NOT report LOS. Signal is normal at -20.1 dBm.", "NORMAL", "INFO"),
        ("No dying gasp detected on ONU-128. Power stable.", "NORMAL", "INFO"),
        ("OLT-01 is reachable. SNMP responding normally.", "NORMAL", "INFO"),
        ("No mass outage. All ONUs online on PON 0/2/7.", "NORMAL", "INFO"),
        ("Temperature normal on OLT-Access-03: 42°C.", "NORMAL", "INFO"),
    ]
    
    samples = []
    for i in range(count):
        text, ec, sev = random.choice(negations)
        samples.append({
            "id": f"ftth-train-neg-{i+1:03d}",
            "event": {
                "source": "synthetic",
                "deviceKind": "ONU",
                "deviceId": f"ONU-{random.randint(100, 999)}",
                "alarmType": "NEGATION_TEST",
                "rawSummary": text
            },
            "label": {
                "eventClass": ec,
                "severity": sev,
                "probableScope": "ONU",
                "requiresInvestigation": False
            },
            "metadata": {
                "generated": True,
                "template": "negation",
                "is_negation": True
            }
        })
    return samples


def main():
    parser = argparse.ArgumentParser(description="Generador de dataset FTTH para Laya")
    parser.add_argument("--count", type=int, default=100, help="Número de eventos a generar")
    parser.add_argument("--output", type=str, default="./v1/train", help="Directorio de salida")
    parser.add_argument("--seed", type=int, default=42, help="Semilla random")
    args = parser.parse_args()
    
    random.seed(args.seed)
    
    print(f"Generando {args.count} eventos FTTH...")
    
    records = []
    
    # Generar eventos por clase (distribución balanceada)
    events_per_class = args.count // len(TEMPLATES)
    
    for template in TEMPLATES:
        for i in range(events_per_class):
            record = generate_event(template, len(records) + 1)
            records.append(record)
    
    # Rellenar si falta
    while len(records) < args.count:
        template = random.choice(TEMPLATES)
        record = generate_event(template, len(records) + 1)
        records.append(record)
    
    # Agregar samples de negación (10% del total)
    negation_count = max(5, args.count // 10)
    negations = generate_negation_samples(negation_count)
    records.extend(negations)
    
    # Mezclar
    random.shuffle(records)
    
    # Guardar en JSONL
    import os
    os.makedirs(args.output, exist_ok=True)
    
    output_file = os.path.join(args.output, "ftth-events.jsonl")
    with open(output_file, "w") as f:
        for record in records:
            f.write(json.dumps(record) + "\n")
    
    # Estadísticas
    class_counts = {}
    for r in records:
        ec = r["label"]["eventClass"]
        class_counts[ec] = class_counts.get(ec, 0) + 1
    
    print(f"\n✅ Dataset generado:")
    print(f"   Total registros: {len(records)}")
    print(f"   Archivo: {output_file}")
    print(f"\n📊 Distribución por clase:")
    for ec, count in sorted(class_counts.items()):
        print(f"   {ec:<22}: {count:3d} ({count/len(records)*100:5.1f}%)")
    
    # Guardar también como JSON para inspección
    stats_file = os.path.join(args.output, "dataset_stats.json")
    with open(stats_file, "w") as f:
        json.dump({
            "total": len(records),
            "class_distribution": class_counts,
            "negation_samples": negation_count,
            "seed": args.seed
        }, f, indent=2)
    print(f"\n💾 Estadísticas: {stats_file}")


if __name__ == "__main__":
    main()
