## SNMP Contribution Overview

### 1. Vendor & Hardware Information
- **Vendor Name**: 
- **Hardware Model / Series**: 
- **Firmware Version(s) Tested**: 
- **Target Support Level**: [ ] L1 (Documented)  [ ] L2 (Simulated)  [ ] L3 (Lab Certified)  [ ] L4 (Field Certified)

### 2. Evidence & Provenance
- **Source ID**: (e.g. `src-vendor-family-v1`)
- **Source Type**: [ ] Vendor MIB  [ ] Hardware Manual  [ ] Vendor Release Notes  [ ] Public Community Repository  [ ] Packet Capture / Walk
- **Source URL or Document Reference**: 
- **License / Terms of Use**: [ ] Open Source / Permissive  [ ] Vendor Public Documentation  [ ] Fair Use Research
- **Confidence Grade**: [ ] Grade A (Official Vendor MIB/Manual)  [ ] Grade B (Community/Verified Repo)  [ ] Grade C (Heuristic/Unverified)

### 3. Sanitization & Privacy Confirmation
- [ ] Raw captures or walks have been processed using `scripts/sanitize-snmp-capture.ts`.
- [ ] No community strings, passwords, or SNMPv3 authentication keys are present.
- [ ] No public or private IPv4/IPv6 addresses are exposed (redacted or replaced with RFC 5737 documentation IPs).
- [ ] No customer PII, subscriber names, circuit IDs, or PPPoE credentials exist in payloads.
- [ ] Serial numbers have payloads masked while keeping standard 4-character vendor prefix.

### 4. Minimal Reproduction & Fixtures
- **Test Fixture Path**: `packages/monitoring/tests/fixtures/<vendor>-<scenario>.json`
- **Adapter Path**: `packages/monitoring/src/snmp/adapter/<vendor>.ts` (if applicable)
- **Unit Test Path**: `packages/monitoring/tests/snmp/<vendor>-adapter.test.ts`

### 5. Verification Checklist
- [ ] `pnpm check:sources` passes with 0 errors.
- [ ] `pnpm check:conflicts` detects no duplicate OID or PEN collisions.
- [ ] `pnpm test:conformance` passes all golden snapshots and fault scenarios.
- [ ] `pnpm turbo run lint typecheck test` succeeds across all workspaces.
