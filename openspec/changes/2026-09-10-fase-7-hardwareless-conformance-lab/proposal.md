# Proposal: Fase 7 — Laboratorio de Conformidad sin Hardware

## Context & Motivation
With 8 vendor adapters elevated to Level L2 (Huawei, ZTE, Nokia, FiberHome, Calix, Adtran, VSOL, BDCOM) alongside RFC Standard and Generic xPON profiles, the OLT multi-vendor integration requires a reproducible, isolated verification harness.

Fase 7 establishes a **Hardwareless Conformance Lab** enabling contributors and CI pipelines to validate all L2 adapters, edge cases, protocol variants (SNMPv1, SNMPv2c, SNMPv3 authPriv), fault conditions, and performance characteristics without requiring physical OLT hardware.

## Proposed Changes

1. **Isolated Net-SNMP Container Environment (`docker/snmp-lab/`)**:
   - Provide a containerized Net-SNMP test environment (`docker/snmp-lab/Dockerfile` based on Alpine with `net-snmp-tools`).
   - Isolate `MIBDIRS` to prevent host MIB pollution and ensure deterministic MIB parsing.
   - Include helper scripts for containerized trap emission and translation.

2. **Binary Packet Generator & Replay Runner (`packages/monitoring/src/snmp/conformance/`)**:
   - Provide a programmatic packet generator and replay runner capable of encoding vendor fixture traps (v1, v2c, v3) into wire-format UDP datagrams.
   - Support replaying recorded fixture dumps into the managed SNMP receiver.

3. **Golden Fixtures for Evidence Envelope & Normalized Events (`tests/conformance/golden/`)**:
   - Establish golden snapshot files for all 8 L2 adapters plus RFC standard.
   - Verify bit-level and schema-level consistency of both `RawSnmpEvidenceEnvelope` and `TelemetryEvent`.

4. **Fault & Resilience Test Suite (`tests/conformance/fault-scenarios.test.ts`)**:
   - **Alarm / Clear Pairs**: Verify clear traps successfully resolve active alarms or mark severity 'ok'.
   - **Duplicate Suppression**: Confirm rapid identical traps within deduplication window are suppressed.
   - **Replay Protection**: Verify v3 engineBoots/engineTime replay rejection and fingerprint matching.
   - **Out-of-Order Delivery**: Verify clear received before alarm or reversed sequence is handled safely.
   - **Clock Skew**: Verify out-of-sync or historical `sysUpTime` values do not corrupt system clocks or crash processing.
   - **Trap Storm / Burst**: Inject a high-volume burst (500+ datagrams) to verify queue bounding, drop metrics, and absence of memory leaks.

5. **Property-Based ASN.1 & Varbind Tests (`tests/conformance/property-asn1.test.ts`)**:
   - Property tests fuzzing malformed ASN.1 lengths, truncated tags, deeply nested sequences, and oversized OIDs.
   - Ensure the parser rejects malformed inputs cleanly without unhandled crashes, and guarantees zero credential leakage in error messages.

6. **Multi-Tenant Isolation Behind Shared Relay / NAT (`tests/conformance/tenant-isolation.test.ts`)**:
   - Test scenarios where multiple OLTs belonging to different tenants originate from the same IP address (e.g. via NAT or SNMP relay).
   - Ensure tenant routing and OLT identification enforce strict tenant boundary isolation without cross-tenant leakage.

7. **Performance Benchmark & CI Artifacts (`scripts/snmp-benchmark.ts`)**:
   - Measure events/second throughput, heap memory delta, drop rates, and p95 / p99 processing latencies.
   - Generate structured conformance report (`research/olt/conformance-report.json`) and documentation (`docs/conformance-benchmark.md`).
