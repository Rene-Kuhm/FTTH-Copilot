---
name: SNMP Source or Capture Contribution
about: Submit new vendor MIBs, documentation, snmpwalk output, or sanitized trap captures
title: "[SNMP Contribution]: <Vendor> - <Model/Family>"
labels: ["snmp", "multi-vendor", "contribution"]
assignees: []
---

### Vendor & Equipment
- **Vendor**: 
- **Model / Chassis**: 
- **Firmware Version**: 
- **PON Technology**: [ ] GPON  [ ] XGS-PON  [ ] EPON  [ ] Combo PON

### Contribution Type
- [ ] Official Vendor MIB files
- [ ] Equipment Operation Manual / CLI guide
- [ ] `snmpwalk` / `snmpget` text output
- [ ] Sanitized binary packet capture (`.pcap`) or JSON trap envelope
- [ ] Errata / Bug report for existing adapter

### Provenance & Licensing
- **Source Link / Origin**: 
- **License / Availability**: 

### Sanitization Statement
*Before attaching any logs or captures, verify they have been scrubbed of:*
1. Passwords, community strings, and SNMPv3 passphrases.
2. Real public or private IP addresses and MAC addresses.
3. Subscriber names, PPPoE accounts, or customer identifiers.
4. Serial numbers (keep vendor prefix like `HWTC`, `ZTEG`, mask trailing unique characters).

### Description & Expected Behavior
*Describe the alarm or metric, including expected trap OID, severity, and clear behavior (if known).*
