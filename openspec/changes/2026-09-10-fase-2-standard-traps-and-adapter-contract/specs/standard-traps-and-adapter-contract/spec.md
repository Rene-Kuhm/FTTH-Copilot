# Standard Traps Baseline & OltVendorAdapter Contract Specification

## ADDED Requirements

### Requirement 1: RFC Standard Traps Coverage
The catalog SHALL define standard traps from SNMPv2-MIB (`coldStart`, `warmStart`, `authenticationFailure`), IF-MIB (`linkDown`, `linkUp`), and ENTITY-MIB (`entConfigChange`), each carrying complete audit metadata (`source_id`, `source_grade`, `target_models`, `firmware`, `license`).
- **Given**: A standard SNMP trap OID (e.g. `1.3.6.1.6.3.1.1.5.5` for authenticationFailure or `1.3.6.1.2.1.47.2.0.1` for entConfigChange).
- **When**: Catalog lookup is performed.
- **Then**: It returns the specific definition with non-null `source_id`, grade 'A', and license 'standard'.

### Requirement 2: IF-MIB Structured Varbind Extraction
The normalization pipeline SHALL extract standard IF-MIB varbinds (`ifIndex`, `ifAdminStatus`, `ifOperStatus`, `ifName`, `ifDescr`, `ifAlias`) when present, populating metrics and tags with human-readable status strings without fabricated values.
- **Given**: A `linkDown` trap containing varbinds `ifIndex=14`, `ifAdminStatus=1` (up), `ifOperStatus=2` (down).
- **When**: The standard adapter normalizes the notification.
- **Then**: `metrics.ifIndex` is 14, `metrics.ifAdminStatus` is 'up', `metrics.ifOperStatus` is 'down', and `deviceKind` is 'OLT'.

### Requirement 3: Multi-Source Device Identity Resolution
The identity engine SHALL correlate the registered sender context, `sysObjectID` (if provided), and the notification Enterprise OID to establish the authoritative vendor and model context.
- **Given**: A trap from an IP registered to `tenant-123`, `olt-alpha`, declared vendor `Huawei`.
- **When**: Identity resolution executes.
- **Then**: The resolved context preserves `tenantId`, `oltId`, and matches the vendor identity.

### Requirement 4: Vendor Ambiguity Rejection
The identity engine SHALL reject conflicting vendor claims (e.g., sender declared as vendor A, but enterprise OID rooted in vendor B's PEN) by falling back to standard handling with an explicit `ambiguity_detected` tag, preventing foreign vendor adapters from running.
- **Given**: An OLT registered as `Huawei` emitting an enterprise trap rooted under ZTE PEN `1.3.6.1.4.1.3902`.
- **When**: Ambiguity checking is performed.
- **Then**: The engine marks the notification as ambiguous, bypasses the Huawei adapter, and uses standard fallback logging.

### Requirement 5: `OltVendorAdapter` Invariants & Purity
All vendor adapters SHALL implement the `OltVendorAdapter` contract. The adapter execution harness SHALL enforce:
1. **Tenant Immutability**: The output `telemetry.v1` event's `tenantId` MUST strictly equal `context.tenantId`.
2. **Pure Transformation**: Adapters cannot perform I/O, execute system commands, or issue SNMP requests.
3. **No Unwarranted Severity Inflation**: Severity cannot exceed catalog definition unless explicit evidence rules in the adapter provide verifiable rationale.
- **Given**: A rogue or faulty adapter attempting to change `tenantId` to another tenant.
- **When**: The adapter runner processes the event.
- **Then**: The runner overrides or rejects the tenant mutation, preserving tenant isolation.

### Requirement 6: Deterministic Adapter Registry
The system SHALL maintain a registry of `OltVendorAdapter` implementations resolving adapters in deterministic order: exact vendor match > standard adapter > fallback unknown trap handler.
- **Given**: An incoming standard trap and a registered Standard adapter.
- **When**: Adapter lookup is performed.
- **Then**: The `StandardOltAdapter` is selected deterministically.

### Requirement 7: Gate 2 Binary Pipeline Ingestion
Standard traps received as binary UDP datagrams SHALL pass through the entire pipeline: binary BER decoder -> raw evidence envelope -> identity resolution -> adapter normalization -> `telemetry.v1` output conforming to `telemetryEventSchema`.
- **Given**: A binary UDP datagram for `coldStart`, `warmStart`, `linkDown`, `linkUp`, `authenticationFailure`.
- **When**: Ingestion pipeline processes the datagram.
- **Then**: A valid `TelemetryEvent` with `schema: 'ftth.telemetry.v1'` is emitted.
