# Fase 6 PR #1 — SNMP Trap Ingestion Catalog, Parser & Normalizer (Spec Delta)

## Why

Meet requirements 6.1 through 6.5 of Roadmap Fase 6 with rigorous type safety, bounded resources, and no fabricated diagnostic claims for unknown traps.

## Scenarios (Given/When/Then)

### Scenario: Known ONU Dying Gasp trap normalizes accurately (6.1, 6.4)

Given a valid SNMP v2c trap packet with enterprise OID for Dying Gasp (e.g. Huawei `1.3.6.1.4.1.2011.6.128.1.1.2.43.2`)
  from authorized sender IP `10.0.1.1` mapped to tenant `tenant-1` and connection `conn-1`
When the trap parser and normalizer process the packet
Then it emits a `TelemetryEvent` with:
  - `source: 'snmp-trap'`
  - `tenantId: 'tenant-1'`
  - `connectionId: 'conn-1'`
  - `severity: 'critical'`
  - metrics containing `snmpTrapOid`, `trapCategory: 'dying_gasp'`
  - no invented cause beyond the reported trap definition.

### Scenario: Known ONU LOS (Loss of Signal) trap normalizes with port/onu coordinates (6.1, 6.4)

Given an SNMP trap with enterprise OID for ONU LOS (e.g. Huawei `1.3.6.1.4.1.2011.6.128.1.1.2.43.1`)
When parsed with varbinds for slot, port, and ONU ID
Then the normalized event reflects `trapCategory: 'los'` with extracted coordinates.

### Scenario: Unknown OID trap does not invent diagnostic conclusions (6.4)

Given an SNMP trap with an unregistered enterprise OID `1.3.6.1.4.1.99999.1.2.3`
When parsed and normalized
Then the output event has:
  - `severity: 'info'`
  - `metrics.trapCategory: 'unknown_trap'`
  - the raw OID and varbinds preserved in event metadata
  - no fabricated diagnosis.

### Scenario: Sender IP determines tenant identity; payload tenant is ignored (6.2)

Given an incoming SNMP trap payload claiming `tenantId: 'tenant-spoofed'`
  received from IP `10.0.1.2` registered to `tenant-real`
When sender identity resolution runs
Then the emitted event is assigned strictly to `tenant-real`
  and the claimed payload tenant is rejected.

### Scenario: Unregistered sender IP is discarded (6.2)

Given an SNMP trap received from unauthorized IP `192.168.1.99` not in registry
When processed
Then the packet is dropped with an audit counter increment and zero state mutation.

### Scenario: High-rate flood of traps is bounded by rate limiter (6.5)

Given a burst of 2000 traps in a 1-second window exceeding the configured threshold (e.g. 1000/min)
When evaluated by the ingestion guard
Then traps within budget are admitted and excess traps are dropped with drop metrics recorded.
