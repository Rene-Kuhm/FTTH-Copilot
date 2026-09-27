#!/usr/bin/env python3
"""
Generador de dataset FTTH basado en CASOS REALES documentados.
Reúne eventos de:
- GPON LOS alarms (Huawei, proveedores)
- Dying gasp patterns
- Mass outages reales (Singapore, China)
- Splitter failures
- ODN faults
- Rogue ONUs
"""

import argparse
import json
import random
from dataclasses import dataclass, asdict
from typing import Optional
from datetime import datetime, timedelta

# ── Casos reales documentados ─────────────────────────────────────────────────

@dataclass
class RealCase:
    """Un caso real documentado de problema FTTH."""
    source: str  # Fuente del caso
    description: str  # Descripción del problema
    device_kind: str
    alarm_types: list
    symptoms: list  # Síntomas observables
    root_cause: str  # Causa raíz
    affected_scope: str  # ONU, PON, OLT, etc.
    severity: str
    treatment: str  # Cómo se resolvió


REAL_CASES = [
    # ── GPON LOS (fuente: Huawei) ──────────────────────────────────────────
    RealCase(
        source="Huawei Technical Support",
        description="Multiple ONUs frequently go online and offline on a PON port",
        device_kind="PON_PORT",
        alarm_types=["LOS", "LCDGi", "SDi", "SFi", "LOFi"],
        symptoms=[
            "All ONUs on PON port go online/offline frequently",
            "OLT reports mass LOS alarms",
            "Service intermittently lost"
        ],
        root_cause="PON port is faulty or ODN quality is poor",
        affected_scope="PON",
        severity="HIGH",
        treatment="Replace PON port or check ODN quality"
    ),
    RealCase(
        source="Huawei Technical Support",
        description="Single ONU or some ONUs frequently go online and offline",
        device_kind="ONU",
        alarm_types=["LOS", "RECOVERY"],
        symptoms=[
            "One or few ONUs affected",
            "Same splitter's other ONUs work fine",
            "Intermittent connectivity"
        ],
        root_cause="Rogue ONU, branch fiber fault, or ONU hardware issue",
        affected_scope="ONU",
        severity="MEDIUM",
        treatment="Check rogue ONU, test branch fiber"
    ),
    RealCase(
        source="Huawei Technical Support",
        description="Feeder fiber broken - total PON outage",
        device_kind="OLT",
        alarm_types=["PON-LOS", "0x2e11a001"],
        symptoms=[
            "All ONUs on GPON card report LOS simultaneously",
            "Complete service loss",
            "No signal from PON port"
        ],
        root_cause="Feeder fiber is broken or unplugged",
        affected_scope="PON",
        severity="CRITICAL",
        treatment="Locate and repair fiber break"
    ),

    # ── Dying Gasp (fuente: Telecomate, Wikipedia) ─────────────────────────
    RealCase(
        source="Telecomate Dying Gasp FAQ",
        description="ONT reports power failure - dying gasp alarm",
        device_kind="ONU",
        alarm_types=["DYING_GASP", "POWER_ALARM"],
        symptoms=[
            "ONT suddenly offline",
            "Dying gasp message sent before shutdown",
            "Power failure at customer premises"
        ],
        root_cause="Customer power outage or ONT power supply failure",
        affected_scope="ONU",
        severity="HIGH",
        treatment="Restore customer power or replace ONT power supply"
    ),

    # ── Mass Outages reales ─────────────────────────────────────────────────
    RealCase(
        source="NetLink Trust Singapore 2026",
        description="Bishan-Thomson fiber outage - third party damage",
        device_kind="PON_PORT",
        alarm_types=["MASS_OUTAGE", "MULTIPLE_ONU_OFFLINE"],
        symptoms=[
            "2000 connections affected",
            "Service disrupted",
            "Multiple ISPs impacted (Singtel, Starhub, M1)"
        ],
        root_cause="Third party contractor cut multiple fiber cables during construction",
        affected_scope="PON",
        severity="CRITICAL",
        treatment="Emergency fiber repair, restore cables"
    ),
    RealCase(
        source="Yantai China Unicom 2026",
        description="Traffic accident broke 3 fiber cables",
        device_kind="PON_PORT",
        alarm_types=["FIBER_CUT", "MULTIPLE_CABLE_BREAK"],
        symptoms=[
            "11 poles knocked down",
            "3 fiber cables with 96 cores each broken",
            "400+ users offline"
        ],
        root_cause="Traffic accident damaged poles and fiber cables",
        affected_scope="PON",
        severity="CRITICAL",
        treatment="Emergency pole and fiber repair"
    ),
    RealCase(
        source="PT ICON+ Indonesia",
        description="Frequent service disruptions in rural area",
        device_kind="PON_PORT",
        alarm_types=["SERVICE_DISRUPTION", "INTERMITTENT_OUTAGE"],
        symptoms=[
            "Repeated outages in same area",
            "Customer complaints",
            "Quality of service degraded"
        ],
        root_cause="Poor fiber infrastructure, multiple causes",
        affected_scope="PON",
        severity="MEDIUM",
        treatment="Infrastructure assessment and upgrades"
    ),

    # ── Splitter Failures ───────────────────────────────────────────────────
    RealCase(
        source="Viavi Solutions",
        description="Splitter failure - partial outage",
        device_kind="SPLITTER",
        alarm_types=["PARTIAL_OUTAGE", "SPLITTER_FAULT"],
        symptoms=[
            "Some ONUs offline, others degraded",
            "Same splitter, different behaviors",
            "Macro bend or splitter damage"
        ],
        root_cause="Internal splitter damage, macro bends, or fiber issues",
        affected_scope="SPLITTER",
        severity="HIGH",
        treatment="Replace splitter or fix fiber issues"
    ),
    RealCase(
        source="Viavi Solutions",
        description="1x32 splitter with one branch down - single customer",
        device_kind="ONU",
        alarm_types=["LOS", "SINGLE_ONU_OFFLINE"],
        symptoms=[
            "Only one customer affected",
            "Same splitter's other ONUs online",
            "Problem between ONT and splitter"
        ],
        root_cause="Drop cable damage, connector issue, or ONT fault",
        affected_scope="ONU",
        severity="MEDIUM",
        treatment="Test drop cable, check connectors"
    ),
    RealCase(
        source="Viavi Solutions",
        description="Macro bend in distribution fiber - affects single branch",
        device_kind="ONU",
        alarm_types=["DEGRADED_SIGNAL", "SLOW_CONNECTION"],
        symptoms=[
            "Single ONT showing poor performance",
            "Fiber may have tight bends",
            "Intermittent issues"
        ],
        root_cause="Macro bend in fiber causing excess attenuation",
        affected_scope="ONU",
        severity="LOW",
        treatment="Locate and fix macro bend in fiber"
    ),

    # ── ODN Issues ─────────────────────────────────────────────────────────
    RealCase(
        source="EXFO App Note 130",
        description="Macro bend causing 4dB loss on one branch",
        device_kind="ONU",
        alarm_types=["MACRO_BEND", "EXCESS_LOSS"],
        symptoms=[
            "One branch affected on 1x32 splitter",
            "Other branches fine",
            "Problem in fiber closure or distribution box"
        ],
        root_cause="Macro bend from improper fiber handling (4dB loss = 8dB at 1650nm)",
        affected_scope="PON",
        severity="MEDIUM",
        treatment="Fix fiber routing in closure"
    ),
    RealCase(
        source="Huawei ODN Faults",
        description="Poor ODN quality - multiple symptoms",
        device_kind="PON_PORT",
        alarm_types=["LCDGi", "SDi", "SFi", "LOFi"],
        symptoms=[
            "Multiple ONUs affected inconsistently",
            "Poor optical quality",
            "Intermittent issues"
        ],
        root_cause="Large reflection, attenuation from improper ODN construction",
        affected_scope="PON",
        severity="HIGH",
        treatment="ODN quality audit and remediation"
    ),

    # ── Rogue ONU (fuente: Huawei) ─────────────────────────────────────────
    RealCase(
        source="Huawei Case Study",
        description="Rogue ONU causing upstream errors on GPON",
        device_kind="ONU",
        alarm_types=["UPSTREAM_ERROR_RATE", "SERVICE_IMMOBILIZATION"],
        symptoms=[
            "Multiple ONUs report upstream errors",
            "Service degradation across PON",
            "Interference pattern"
        ],
        root_cause="Uncontrolled ONU emitting abnormal light-wave",
        affected_scope="PON",
        severity="HIGH",
        treatment="Locate and disconnect rogue ONU"
    ),

    # ── OLT Issues ────────────────────────────────────────────────────────
    RealCase(
        source="Huawei",
        description="OLT board failure - all PONs affected",
        device_kind="OLT",
        alarm_types=["BOARD_FAILURE", "MULTIPLE_PON_DOWN"],
        symptoms=[
            "All PON ports on a board affected",
            "Multiple OLT alarms",
            "Large scale outage"
        ],
        root_cause="Board or slot hardware failure",
        affected_scope="OLT",
        severity="CRITICAL",
        treatment="Replace board or move services to backup"
    ),
    RealCase(
        source="Common OLT",
        description="OLT temperature high - thermal throttling",
        device_kind="OLT",
        alarm_types=["HIGH_TEMPERATURE", "THERMAL_SHUTDOWN"],
        symptoms=[
            "OLT running hot",
            "Performance degradation",
            "Potential shutdown warnings"
        ],
        root_cause="Cooling failure, high ambient temperature, fan failure",
        affected_scope="OLT",
        severity="HIGH",
        treatment="Check cooling system, reduce load, improve ventilation"
    ),

    # ── Configuration Issues ────────────────────────────────────────────────
    RealCase(
        source="China FTTH Cases",
        description="LOID mismatch - ONT not registering",
        device_kind="ONU",
        alarm_types=["REGISTRATION_FAIL", "LOID_MISMATCH"],
        symptoms=[
            "ONT PON light blinking",
            "ONT not coming online",
            "Service not provisioned"
        ],
        root_cause="LOID on ONT doesn't match OLT PON port configuration",
        affected_scope="ONU",
        severity="MEDIUM",
        treatment="Check and correct LOID configuration"
    ),
    RealCase(
        source="PPPoE Error 691",
        description="Authentication failure after new ONT",
        device_kind="ONU",
        alarm_types=["AUTH_FAILURE", "PPPOE_ERROR"],
        symptoms=[
            "User cannot connect",
            "Error 691 or similar",
            "ONT appears online"
        ],
        root_cause="Account credentials mismatch or ONT not registered properly",
        affected_scope="ONU",
        severity="LOW",
        treatment="Verify credentials, re-register ONT"
    ),

    # ── Normal Operations ───────────────────────────────────────────────────
    RealCase(
        source="Routine Operation",
        description="Normal ONT operation - no issues",
        device_kind="ONU",
        alarm_types=["NONE", "HEARTBEAT"],
        symptoms=[
            "ONT online",
            "Normal RX power (-8 to -25 dBm)",
            "All services working"
        ],
        root_cause="N/A - normal operation",
        affected_scope="NORMAL",
        severity="INFO",
        treatment="None - normal operation"
    ),
    RealCase(
        source="Routine Maintenance",
        description="Planned maintenance window",
        device_kind="OLT",
        alarm_types=["MAINTENANCE", "PLANNED_OUTAGE"],
        symptoms=[
            "Service degradation during window",
            "Announced outage",
            "Recovery after maintenance"
        ],
        root_cause="Planned network maintenance",
        affected_scope="OLT",
        severity="LOW",
        treatment="Complete maintenance as planned"
    ),

    # ── Uplink/Congestion Issues ────────────────────────────────────────────
    RealCase(
        source="Bandwidth Congestion",
        description="Peak hour congestion on uplink",
        device_kind="OLT",
        alarm_types=["CONGESTION", "HIGH_UTILIZATION"],
        symptoms=[
            "High bandwidth utilization (>80%)",
            "Slow speeds during peak hours",
            "Multiple customers affected"
        ],
        root_cause="Insufficient uplink capacity for peak demand",
        affected_scope="UPLINK",
        severity="MEDIUM",
        treatment="Upgrade uplink capacity, implement QoS"
    ),
    RealCase(
        source="Uplink Failure",
        description="Uplink port down - redundancy activated",
        device_kind="OLT",
        alarm_types=["UPLINK_DOWN", "PORT_FAILURE"],
        symptoms=[
            "Primary uplink offline",
            "Failover to backup path",
            "Service maintained but degraded"
        ],
        root_cause="Uplink cable or port failure",
        affected_scope="UPLINK",
        severity="CRITICAL",
        treatment="Restore primary uplink, investigate cause"
    ),
]


def generate_real_event(case: RealCase, event_id: int) -> dict:
    """Genera un evento realista basado en un caso real documentado."""
    
    # Templates de mensajes según tipo de dispositivo y alarm
    templates_by_type = {
        "OLT": [
            f"OLT-{case.device_kind}-{random.randint(1, 20):02d} reports {case.alarm_types[0]}. {case.symptoms[0]}.",
            f"Critical alert from OLT-Aggregation-{random.randint(1, 10)}: {case.alarm_types[0]} detected. {case.symptoms[0] if case.symptoms else 'Service affected.'}",
            f"OLT-North-{random.randint(1, 10)} alarm: {case.alarm_types[0]}. {case.root_cause[:50]}...",
        ],
        "PON_PORT": [
            f"PON 0/{random.randint(0, 4)}/{random.randint(0, 15)} reports {case.alarm_types[0]}. {case.symptoms[0]}.",
            f"GPON port alarm: {case.alarm_types[0]}. {case.symptoms[0]}. Possible {case.root_cause[:40]}.",
            f"PON port status change: {case.alarm_types[0]}. {len(random.sample(['ONU-{:04d}'.format(i) for i in range(100, 500)], min(8, random.randint(3, 16))))} ONUs affected.",
        ],
        "ONU": [
            f"ONU-{random.randint(100, 9999):04d} reports {case.alarm_types[0]}. {case.symptoms[0] if case.symptoms else 'Signal issue detected'}.",
            f"ONT alert from customer premises: {case.alarm_types[0]}. {case.root_cause[:50]}...",
            f"Device {random.choice(['Nokia', 'Huawei', 'ZTE'])} ONT reports: {case.alarm_types[0]}. Customer affected.",
        ],
        "SPLITTER": [
            f"Splitter fault detected on PON 0/{random.randint(0, 4)}/{random.randint(0, 15)}. {case.symptoms[0]}.",
            f"1x{random.choice([8, 16, 32])} splitter showing {case.alarm_types[0]}. {case.root_cause[:40]}.",
        ],
    }
    
    template = templates_by_type.get(case.device_kind, templates_by_type["ONU"])
    summary = random.choice(template)
    
    # Agregar detalles adicionales basados en síntomas
    if len(case.symptoms) > 1 and random.random() > 0.5:
        summary += f" Additional: {case.symptoms[1][:60]}."
    
    # Mapear severidad
    severity_map = {
        "INFO": "INFO",
        "LOW": "LOW", 
        "MEDIUM": "MEDIUM",
        "HIGH": "HIGH",
        "CRITICAL": "CRITICAL"
    }
    
    # Mapear affected_scope a probableScope
    scope_map = {
        "NORMAL": "NORMAL",
        "ONU": "ONU",
        "PON": "PON",
        "SPLITTER": "SPLITTER",
        "OLT": "OLT",
        "CTO": "CTO",
    }
    
    # Mapear caso a eventClass
    if case.severity == "INFO":
        event_class = "NORMAL"
    elif "DYING_GASP" in case.alarm_types or "POWER" in case.alarm_types[0]:
        event_class = "POWER_FAULT"
    elif "MASS" in case.alarm_types[0] or len(case.symptoms) > 0 and "Multiple" in case.symptoms[0]:
        event_class = "MASS_OUTAGE"
    elif "CONGESTION" in case.alarm_types[0] or "UTILIZATION" in case.alarm_types[0]:
        event_class = "CONGESTION"
    elif "UPLINK" in case.alarm_types[0]:
        event_class = "UPLINK_FAULT"
    elif "TEMPERATURE" in case.alarm_types[0] or "THERMAL" in case.alarm_types[0]:
        event_class = "DEVICE_FAULT"
    elif "LOS" in case.alarm_types[0] or "FIBER" in case.alarm_types[0] or "CUT" in case.alarm_types[0]:
        event_class = "OPTICAL_FAULT"
    elif "DEGRAD" in case.alarm_types[0] or "MACRO" in case.alarm_types[0]:
        event_class = "OPTICAL_DEGRADATION"
    elif "SPLITTER" in case.alarm_types[0]:
        event_class = "OPTICAL_FAULT"
    else:
        event_class = "DEVICE_FAULT"
    
    # Determinar si requiere investigación
    requires_investigation = case.severity in ["HIGH", "CRITICAL", "MEDIUM"]
    
    event = {
        "eventId": f"ftth-real-{event_id:05d}",
        "source": random.choice(["snmp", "smartolt", "syslog", "nms"]),
        "vendor": random.choice(["Huawei", "Nokia", "ZTE", "Cisco"]),
        "deviceKind": case.device_kind,
        "deviceId": f"{case.device_kind}-{random.randint(100, 9999)}",
        "alarmType": random.choice(case.alarm_types),
        "rawSummary": summary,
        "caseSource": case.source,
    }
    
    # Agregar RX power para eventos ópticos
    if event_class in ["OPTICAL_FAULT", "OPTICAL_DEGRADATION"]:
        if event_class == "OPTICAL_FAULT":
            event["rxPower"] = round(random.uniform(-30, -25), 1)
        else:
            event["rxPower"] = round(random.uniform(-23, -27), 1)
    
    # Agregar affected count para mass outage
    if event_class == "MASS_OUTAGE":
        event["affectedOnus"] = random.randint(8, 128)
    
    record = {
        "id": f"ftth-real-{event_id:05d}",
        "event": event,
        "label": {
            "eventClass": event_class,
            "severity": severity_map.get(case.severity, "MEDIUM"),
            "probableScope": scope_map.get(case.affected_scope, "UNKNOWN"),
            "requiresInvestigation": requires_investigation,
        },
        "metadata": {
            "source": "real_case_study",
            "caseSource": case.source,
            "rootCause": case.root_cause,
            "treatment": case.treatment,
        }
    }
    
    return record


def generate_negation_event(event_id: int) -> dict:
    """Genera eventos de negación (no hay problema)."""
    negations = [
        "No LOS detected. All ONUs online with normal RX power (-20.1 dBm).",
        "System check complete. No alarms active. Network operating normally.",
        "Routine SNMP poll: OLT-01 responding. All PON ports operational.",
        "Health check: No Dying Gasp reports. All ONTs have stable power.",
        "Monitoring: No mass outage patterns detected. Single ONT offline confirmed as customer-side issue.",
        "Optical power levels normal across all PON ports. No degradation observed.",
    ]
    
    return {
        "id": f"ftth-neg-{event_id:05d}",
        "event": {
            "eventId": f"ftth-neg-{event_id:05d}",
            "source": random.choice(["snmp", "smartolt"]),
            "deviceKind": random.choice(["ONU", "OLT", "PON_PORT"]),
            "deviceId": f"{random.choice(['OLT', 'ONU'])}-{random.randint(1, 999):03d}",
            "alarmType": "NONE",
            "rawSummary": random.choice(negations),
        },
        "label": {
            "eventClass": "NORMAL",
            "severity": "INFO",
            "probableScope": "NORMAL",
            "requiresInvestigation": False,
        },
        "metadata": {
            "source": "negation_test",
            "is_negation": True,
        }
    }


def generate_ambiguous_event(event_id: int) -> dict:
    """Genera eventos ambiguos para probar UNKNOWN classification."""
    ambigous = [
        "Received unknown alarm code 0xFF31 from device ONT-1234. Message: 'Vendor-specific event'.",
        "Non-standard notification from OLT-01: interface status changed but no standard alarm raised.",
        "Ambiguous signal detected on PON 0/2/7. Unable to determine cause from available data.",
        "Device UNK-001 reported event without clear classification. Manual investigation required.",
        "Syslog message received: 'FIBER-INFO: Unknown event type'. No mapping to standard alarm.",
    ]
    
    return {
        "id": f"ftth-ambig-{event_id:05d}",
        "event": {
            "eventId": f"ftth-ambig-{event_id:05d}",
            "source": "syslog",
            "deviceKind": "UNKNOWN",
            "deviceId": "UNKNOWN",
            "alarmType": "UNKNOWN_ALARM",
            "rawSummary": random.choice(ambigous),
        },
        "label": {
            "eventClass": "UNKNOWN",
            "severity": "INFO",
            "probableScope": "UNKNOWN",
            "requiresInvestigation": True,
        },
        "metadata": {
            "source": "ambiguous_case",
        }
    }


def main():
    parser = argparse.ArgumentParser(description="Generador de dataset FTTH basado en casos reales")
    parser.add_argument("--count", type=int, default=100, help="Número de eventos a generar")
    parser.add_argument("--output", type=str, default="./v2/train", help="Directorio de salida")
    parser.add_argument("--seed", type=int, default=42, help="Semilla random")
    args = parser.parse()
    
    random.seed(args.seed)
    
    print(f"Generando {args.count} eventos basados en casos reales...")
    print(f"Casos reales disponibles: {len(REAL_CASES)}")
    
    records = []
    
    # Generar eventos basados en casos reales
    real_count = int(args.count * 0.7)  # 70% casos reales
    negation_count = int(args.count * 0.15)  # 15% negaciones
    ambiguous_count = args.count - real_count - negation_count  # 15% ambiguos
    
    for i in range(real_count):
        case = random.choice(REAL_CASES)
        record = generate_real_event(case, len(records) + 1)
        records.append(record)
    
    for i in range(negation_count):
        record = generate_negation_event(len(records) + 1)
        records.append(record)
    
    for i in range(ambiguous_count):
        record = generate_ambiguous_event(len(records) + 1)
        records.append(record)
    
    # Mezclar
    random.shuffle(records)
    
    # Guardar
    import os
    os.makedirs(args.output, exist_ok=True)
    
    output_file = os.path.join(args.output, "ftth-real-events.jsonl")
    with open(output_file, "w") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    
    # Estadísticas
    class_counts = {}
    for r in records:
        ec = r["label"]["eventClass"]
        class_counts[ec] = class_counts.get(ec, 0) + 1
    
    print(f"\n✅ Dataset generado (basado en casos reales):")
    print(f"   Total registros: {len(records)}")
    print(f"   Casos reales: {real_count}")
    print(f"   Negaciones: {negation_count}")
    print(f"   Ambiguos: {ambiguous_count}")
    print(f"   Archivo: {output_file}")
    print(f"\n📊 Distribución por clase:")
    for ec, count in sorted(class_counts.items()):
        print(f"   {ec:<22}: {count:3d} ({count/len(records)*100:5.1f}%)")
    
    # Guardar fuentes
    sources_file = os.path.join(args.output, "case_sources.json")
    sources = list(set([c.source for c in REAL_CASES]))
    with open(sources_file, "w") as f:
        json.dump({
            "cases": len(REAL_CASES),
            "sources": sources,
            "real_cases": [asdict(c) for c in REAL_CASES],
        }, f, indent=2, ensure_ascii=False)
    print(f"\n💾 Fuentes de casos reales: {sources_file}")


if __name__ == "__main__":
    main()
