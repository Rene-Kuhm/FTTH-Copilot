# Contributing SNMP Adapters and OLT Support

Welcome to the FTTH-Copilot multi-vendor OLT monitoring project. This guide explains how operators, vendors, and community developers can add or enhance support for Optical Line Terminals (OLTs) and Optical Network Units (ONUs).

---

## 1. Principles & Constraints

1. **Observation Only**: The system operates strictly in passive ingestion mode. We NEVER issue SNMP `SET` commands, CLI writes, or execute active remediation towards the physical OLT.
2. **Deterministic Evidence**: No OID or vendor mapping is accepted without provenance. Every definition must link to an official vendor MIB, hardware manual, public repository, or sanitized field capture.
3. **Zero Secret Leakage**: All contributed captures, logs, and fixtures MUST be sanitized prior to commit. Community strings, IP addresses, customer identifiers, and device serial numbers must be redacted or masked.
4. **Hardwareless Reproducibility**: Contributions must include test fixtures and unit tests so CI can verify adapter behavior without needing physical hardware.

---

## 2. Support Levels

Every hardware family is classified under one of four support levels:

| Level | Description | Criteria |
|---|---|---|
| **L1 (Documented)** | Research & MIBs cataloged | Valid `sources.yaml` and `compatibility.yaml` with verified IANA PEN. Architectural boundaries documented. |
| **L2 (Simulated)** | Adapter implemented & tested | Unit tests pass with synthetic fixtures, golden snapshots, and loopback UDP replays. Zero regressions. |
| **L3 (Lab Certified)** | Hardware lab verified | Executed in a controlled physical lab or virtualized vendor simulator with verified alarm/clear cycles. |
| **L4 (Field Certified)** | Production certified | Deployed in live production ISP environments under shadow mode with proven accuracy. |

---

## 3. Contribution Step-by-Step Workflow

### Step 1: Gather Source Documents
Collect MIB definitions, product manuals, or diagnostic walks (`snmpwalk`). Note the vendor name, hardware model, and firmware version.

### Step 2: Sanitize Captures & Logs
Run the built-in sanitization utility on any text log or JSON capture before adding it to the repository:
```bash
# Sanitize a text walk or log
pnpm sanitize:snmp --input raw-capture.log --output sanitized-capture.log

# Sanitize a JSON envelope
pnpm sanitize:snmp --input raw-trap.json --output sanitized-trap.json
```
The sanitizer will automatically:
- Replace community strings with `<REDACTED_COMMUNITY>`.
- Map IP addresses to RFC 5737 documentation ranges (`192.0.2.x`, `198.51.100.x`).
- Redact internal hostnames and subscriber PII.
- Mask serial numbers while preserving the 4-character vendor prefix (e.g. `HWTC`, `ZTEG`, `ALCL`, `FHTT`).

### Step 3: Register Sources in Research
Create or update files in `research/olt/<vendor>/`:
- `sources.yaml`: list of evidence artifacts with confidence grade (A/B/C/D), licensing, and extracted fact OIDs.
- `compatibility.yaml`: vendor metadata, hardware families, supported firmware, and assigned support level.

Run the sources validator:
```bash
pnpm check:sources
```

### Step 4: Add Test Fixtures
Place representative trap payloads in `packages/monitoring/tests/fixtures/<vendor>-<scenario>.json`.
Include:
- Raw OIDs and varbinds.
- Clear traps paired with alarm traps (verifying `isClear: true` and `clearsCategory`).

### Step 5: Implement or Extend Adapter
Implement your vendor adapter in `packages/monitoring/src/snmp/adapter/<vendor>.ts` implementing the `OltVendorAdapter` interface:
- `canHandle(trap)`: match vendor enterprise OID prefix or Enterprise Number.
- `normalize(trap)`: extract slot, port, onuId, and serial number; return canonical `TelemetryEvent`.

Register your adapter in `packages/monitoring/src/snmp/adapter/registry.ts`.

### Step 6: Verify Conformance & Collisions
Run the full verification suite:
```bash
# Verify no OID collisions or semantic conflicts
pnpm check:conflicts

# Run conformance test suite
pnpm test:conformance

# Run full monorepo validation
pnpm turbo run lint typecheck test
```

### Step 7: Open a Pull Request
Use the `.github/PULL_REQUEST_TEMPLATE/snmp_contribution.md` template when opening your PR on GitHub.
