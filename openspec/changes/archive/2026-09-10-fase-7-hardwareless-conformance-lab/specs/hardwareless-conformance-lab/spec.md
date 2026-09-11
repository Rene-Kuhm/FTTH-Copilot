# Specification: Fase 7 — Laboratorio de Conformidad sin Hardware

## Acceptance Criteria

### Requirement 1: Containerized Net-SNMP Environment with Isolated MIBDIR
- The repository MUST provide a container definition (`docker/snmp-lab/Dockerfile`) equipped with `net-snmp` and `net-snmp-tools`.
- The container environment MUST isolate `MIBDIRS` to prevent reliance on host system MIB paths and ensure deterministic MIB parsing across environments.
- The environment MUST provide script utilities for emitting traps, translating OIDs, and executing conformance checks.

### Requirement 2: Binary Packet Generation & Replay Runner
- The conformance harness MUST provide a binary packet generator and replay runner capable of constructing valid SNMPv1, SNMPv2c, and SNMPv3 (authPriv) datagrams from vendor fixture definitions.
- The harness MUST be capable of sending these datagrams over UDP loopback to the managed SNMP receiver and verifying end-to-end receipt.

### Requirement 3: Golden Files for Raw Envelopes and Normalized Telemetry
- The repository MUST maintain golden snapshot files for all Level L2 vendors (Huawei, ZTE, Nokia, FiberHome, Calix, Adtran, VSOL, BDCOM) plus RFC Standard traps.
- Conformance tests MUST verify that raw incoming packets match the golden `RawSnmpEvidenceEnvelope` (redacted OIDs, ASN.1 types, canonical fingerprint) and that adapter normalization produces the exact expected `TelemetryEvent` without schema violations.

### Requirement 4: Fault & Resilience Conformance Scenarios
- **Alarm / Clear Pairs**: A clear trap MUST successfully normalize with `isClear: true` and appropriate `clearsCategory`.
- **Duplicate Trap Suppression**: Traps with matching deduplication fingerprints within the configured suppression window MUST be deduplicated without duplicate telemetry events.
- **Replay Protection**: SNMPv3 replay attempts and identical packet replays MUST be handled safely and flagged or suppressed.
- **Reorder Tolerance**: Receiving a clear notification prior to an alarm or inverted packet sequences MUST be processed without crash or corrupted state.
- **Clock Skew Resilience**: SysUpTime regressions, epoch jumps, or out-of-sync timestamps MUST NOT destabilize receiver timing or event sequencing.
- **Burst / Trap Storm**: A burst of 500+ datagrams MUST be handled without memory leaks, unhandled promise rejections, or queue buffer corruption; dropped packets MUST be tracked via drop counters.

### Requirement 5: Property-Based Testing for ASN.1 and Varbinds
- The conformance suite MUST include property-based / generative tests fuzzing malformed lengths, truncated PDU headers, deeply nested TLVs, and oversized OIDs.
- The parser MUST cleanly reject malformed data with zero uncaught exceptions.
- Zero sensitive credentials (such as community strings or authentication/privacy keys) MUST appear in error messages, exception stack traces, or raw evidence envelopes.

### Requirement 6: Multi-Tenant Isolation Behind Shared Relay / NAT
- When multiple OLTs belonging to distinct tenants share a source IP address (as in an SNMP proxy, NAT gateway, or routed relay scenario), the receiver MUST correctly isolate notifications according to tenant registration rules.
- Cross-tenant event leakage or metric attribution MUST be strictly prevented.

### Requirement 7: Performance Benchmarking & Gate 7 Validation
- The test harness MUST measure sustained event throughput (events/sec), memory delta, drop rates, and p95 / p99 processing latency.
- The results MUST be exported as a machine-readable report (`research/olt/conformance-report.json`) and documented in `docs/conformance-benchmark.md`.
- All tests MUST pass in CI without requiring physical OLT hardware.
