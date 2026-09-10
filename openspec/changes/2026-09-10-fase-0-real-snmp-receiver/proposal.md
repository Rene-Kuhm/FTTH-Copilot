# Fase 0 — Real Binary SNMP Receiver & Raw Evidence

## Why

Roadmap `docs/roadmap-olt-multivendor.md` (Fase 0):
- Replace the preliminary scaffolding in `apps/web/lib/monitoring/snmp.ts` (which previously hardcoded a fixed dummy v2c `linkDown` trap and ignored incoming UDP bytes) with a real, verifiable binary SNMP receiver.
- Provide end-to-end BER/ASN.1 datagram decoding for SNMP v1, v2c (TrapV2, Inform), and v3 (RFC 3414 USM authPriv/authNoPriv).
- Implement Inform response protocol handling (RFC 3416 / RFC 1905).
- Prevent duplicate collision vulnerabilities caused by `IP:size` fingerprinting by switching to a canonical notification fingerprint (sender IP, SNMP version, request ID / timestamp, enterprise/trap OID, and varbind digest).
- Preserve raw evidence envelopes (immutable, bounded, with redacted credentials) so downstream phases can re-parse and audit notifications without loss of fidelity.
- Strictly adhere to observation mode: zero network mutation, zero SNMP `SET` commands, receiver disabled by default.

## What changes

1. **Decoder & Receiver Core (`packages/monitoring/src/snmp/`)**:
   - Integrate `net-snmp` (v3.26.3) as the maintained, RFC-compliant ASN.1/BER decoding and USM cryptographic engine.
   - Support SNMP v1 traps (`TrapPDU`), SNMP v2c (`TrapV2PDU`, `InformRequestPDU`), and SNMP v3 (RFC 3414 USM user authentication & decryption).
   - Automatically send Inform responses (`ResponsePDU` with error-status `noError`) back to the sender when an Inform is received and accepted.
   - Distinguish `eventTime` (timestamp reported inside the notification varbinds/sysUpTime) from `receivedAt` (local monotonic wall-clock reception time).
2. **Canonical Fingerprinting & Guard Enhancement (`packages/monitoring/src/snmp/guard.ts`)**:
   - Replace naive `${ip}:${msg.length}` signature with deterministic canonical hash of `(senderIp, version, requestId, trapOid, varbinds)`.
   - Prevent distinct traps of identical byte length from colliding or suppressing each other.
3. **Evidence Envelope & Redaction (`packages/monitoring/src/snmp/evidence.ts`)**:
   - Produce a structured, immutable `RawSnmpEvidenceEnvelope` containing sanitized metadata, decoded varbinds, and redacted community strings / USM credentials.
4. **App Service Integration (`apps/web/lib/monitoring/snmp.ts`)**:
   - Wire the binary decoder and Inform responder into the UDP receiver service.
   - Maintain default-disabled state (`SNMP_RECEIVER_ENABLED=false`).
5. **Testing & Tooling**:
   - Unit and property tests covering malformed packets, truncated buffers, ASN.1 syntax errors, payload limits, replay attacks, and unknown senders.
   - Integration test script `pnpm test:snmp` demonstrating real binary trap generation and reception in CI.
