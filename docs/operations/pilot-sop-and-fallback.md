# Pilot Standard Operating Procedure (SOP) & Manual Fallback

**Document ID**: `SOP-PILOT-COGNITIVE-001`  
**Governing Roadmap Phase**: Fase 7 — 7.1 & Gate 7  
**Scope**: Cognitive Investigation and SNMP Trap Integration Pilot  

---

## 1. Objective

Provide a concrete, reliable manual operational procedure for NOC engineers when the Cognitive Investigation assistant is unenabled, experiencing high error rates, abstaining due to missing data, or rolled back.

---

## 2. Emergency Kill-Switch & Rollback Procedure

If unexpected behavior, performance degradation, or security anomalies (e.g. cross-tenant leakage suspicion) occur:

1. **Disable Feature Flags Immediately**:
   Set environment variables or tenant policy:
   ```bash
   COGNITIVE_INVESTIGATION_ENABLED=false
   SNMP_RECEIVER_ENABLED=false
   ```
2. **Verify Socket De-allocation**:
   Confirm the UDP SNMP receiver socket is closed via `/api/health` or system logs (`recordSnmpBound(false)`).
3. **Data Preservation Guarantee**:
   In accordance with `docs/security/retention-and-redaction.md`, **do not drop or delete** historical investigations, feedback rows, or telemetry samples. Disabling flags ceases automated analysis without losing audit trails.

---

## 3. Manual NOC Diagnostic Workflow (Fallback Mode)

When cognitive investigations are bypassed:

### Step 1: Direct Telemetry & Alarm Inspection
- Query raw metrics via the monitoring dashboard:
  - Check OLT upstream optical levels (Rx dBm). Normal range: `-8 dBm` to `-27 dBm`.
  - Review ONU signal attenuation. A drop > 3 dB indicates fiber bend or dirty connector.
  - Check Dying Gasp trap notifications for power loss vs fiber cut.

### Step 2: Temporal Topology Verification
- Inspect the physical topology hierarchy:
  `OLT -> PON Port -> Primary Splitter -> CTO -> Drop Cable -> ONU`.
- Determine outage scope:
  - If multiple ONUs on the same PON port lose sync simultaneously -> **Feeder fiber cut or OLT port failure**.
  - If multiple ONUs on the same CTO lose signal -> **Distribution branch cut or splitter port defect**.
  - If a single ONU loses power/signal -> **Drop cable fault, CPE failure, or customer power outage**.

### Step 3: Maintenance Windows Validation
- Check active maintenance windows:
  - Access `/api/maintenance-windows`.
  - Verify whether scheduled work coincides with the affected nodes.
  - If work is active, notify dispatch that the incident is within an approved maintenance context before field escalation.

---

## 4. Escalation & Contact Matrix

| Role | Contact | Responsibility |
|---|---|---|
| NOC Level 1 | `noc-l1@ftth-provider.net` | Initial triage & manual telemetry check |
| NOC Level 2 / Lead | `noc-lead@ftth-provider.net` | Topology trace & fiber dispatch approval |
| Platform Engineering | `platform-oncall@ftth-provider.net` | Rollback flag execution & service health |
