# Real Binary SNMP Receiver & Raw Evidence Specification

## ADDED Requirements

### Requirement 1: Real Binary SNMPv1 Trap Ingestion
The system SHALL parse ASN.1/BER binary datagrams containing SNMPv1 Trap PDUs, extracting enterprise OID, generic/specific trap codes, agent address, upTime, and typed varbinds.
- **Given**: A registered OLT sender IP and an incoming binary SNMPv1 Trap PDU.
- **When**: The packet is ingested by the SNMP receiver.
- **Then**: The trap is decoded with its real enterprise OID and varbinds into a structured raw evidence envelope, and normalized to `telemetry.v1`.

### Requirement 2: Real Binary SNMPv2c TrapV2 Ingestion
The system SHALL parse ASN.1/BER binary datagrams containing SNMPv2c TrapV2 PDUs, extracting `sysUpTime.0`, `snmpTrapOID.0`, and arbitrary typed varbinds (Integer, OctetString, OID, IpAddress, Counter, Gauge, TimeTicks).
- **Given**: A registered OLT sender IP and an incoming binary SNMPv2c TrapV2 datagram with matching community.
- **When**: The packet is received.
- **Then**: The receiver extracts the true trap OID and varbinds from the payload bytes rather than hardcoded dummies.

### Requirement 3: SNMPv2c Inform Request & Acknowledgment
The system SHALL parse SNMPv2c InformRequest PDUs and automatically respond to the sender with a valid `ResponsePDU` (`noError`, error index 0, matching request ID and varbinds) over UDP.
- **Given**: An OLT transmitting an SNMP InformRequest PDU.
- **When**: The receiver accepts the packet.
- **Then**: It sends back a standard SNMP Response PDU to the sender's source port and processes the notification event.

### Requirement 4: SNMPv3 USM Ingestion (RFC 3414)
The system SHALL support SNMPv3 traps with USM user authentication (`authNoPriv` with MD5/SHA) and privacy (`authPriv` with DES/AES), rejecting unauthenticated or unauthorized datagrams.
- **Given**: An OLT sender registered with SNMPv3 USM credentials (security name, auth/priv protocols and keys).
- **When**: A binary SNMPv3 packet arrives with valid cryptographic signatures.
- **Then**: The payload is decrypted, verified, and parsed into a normalized event and raw evidence envelope.

### Requirement 5: Separation of Timestamps (eventTime, sysUpTime, receivedAt)
The receiver SHALL keep `receivedAt` (wall-clock timestamp recorded at datagram arrival), `sysUpTime` (device uptime in TimeTicks from PDU), and `eventTime` (device alarm timestamp if reported) strictly separated.
- **Given**: A notification packet with `sysUpTime.0` of 123456 TimeTicks received at timestamp `T_recv`.
- **When**: The raw evidence envelope and telemetry event are produced.
- **Then**: `receivedAt` records `T_recv`, `sysUpTime` records 123456, and neither overwrites the other.

### Requirement 6: Canonical Fingerprinting without Size Collision
The system SHALL compute duplicate detection signatures using a canonical cryptographic hash of `(senderIp, version, requestId, trapOid, varbinds)`.
- **Given**: Two distinct trap notifications arriving from the same sender that happen to have the exact same byte length.
- **When**: The deduplication guard evaluates both packets.
- **Then**: Neither packet is falsely dropped as a duplicate; both are accepted and processed.

### Requirement 7: Raw Evidence Envelope & Credential Redaction
The system SHALL preserve an immutable raw evidence envelope for each accepted trap, capturing all decoded varbinds, OIDs, and types, while redacting community strings, auth keys, and priv keys.
- **Given**: An incoming trap with community string `"secret-comm"` or USM auth parameters.
- **When**: The evidence envelope is produced.
- **Then**: All varbinds and OIDs are preserved, but credentials are removed or replaced with `"[REDACTED]"`.

### Requirement 8: Unknown OID Preservation without Fabricated Claims
The system SHALL preserve unknown vendor OIDs in raw evidence and normalize them to `category: 'unknown_trap'`, `severity: 'info'` without inventing diagnoses or network state.
- **Given**: A trap with an uncataloged private enterprise OID.
- **When**: The trap is normalized.
- **Then**: The event preserves the exact OID and varbinds in tags/metrics with `category: 'unknown_trap'`, without triggering false alarms.

### Requirement 9: Ingestion Guard & Robustness under Adversarial Payloads
The system SHALL reject datagrams exceeding `maxPayloadBytes`, discard malformed or truncated ASN.1 frames without throwing unhandled exceptions, throttle flood rates, and drop unregistered sender IPs.
- **Given**: A corrupted or oversized UDP packet (> 2048 bytes) or an unregistered sender IP.
- **When**: The packet reaches the UDP socket.
- **Then**: It is safely dropped before any downstream mutation, recording an error metric without crashing the process.
