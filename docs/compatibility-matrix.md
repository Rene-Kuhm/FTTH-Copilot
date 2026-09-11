# Multi-Vendor OLT Compatibility Matrix

Auto-generated from authoritative vendor sources in `research/olt/`.

## 1. Summary Statistics

- **Total Vendors Registered**: 12
- **Total Hardware Families**: 19
- **Documented Sources**: 23
- **Verified OID Facts**: 64

| Support Level | Hardware Families | Status |
|---|---|---|
| **Level L1 (Documented)** | 7 | Research cataloged, MIBs registered, architectural limits documented |
| **Level L2 (Simulated)** | 12 | Full adapter implemented, synthetic & loopback UDP tests passing |
| **Level L3 (Lab Certified)** | 0 | Physical lab hardware validated with real alarms (Fase 9) |
| **Level L4 (Field Certified)** | 0 | Live production certified with zero false-positives (Fase 9) |

## 2. Canonical Compatibility Table

| Priority | Vendor | Family / Series | Firmware | Level | Grade | Sources |
|---|---|---|---|---|---|---|
| P0 | [FiberHome](../research/olt/fiberhome/) | AN5516 | unknown | **L2** | B | 2 |
| P0 | [FiberHome](../research/olt/fiberhome/) | AN6000 | unknown | **L2** | B | 3 |
| P0 | [Huawei](../research/olt/huawei/) | MA5600 | unknown | **L2** | B | 2 |
| P0 | [Huawei](../research/olt/huawei/) | MA5800 | unknown | **L2** | B | 2 |
| P0 | [Nokia](../research/olt/nokia/) | 7360-ISAM-FX | unknown | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | Lightspan-MF | unknown | **L2** | A | 1 |
| P0 | [ZTE](../research/olt/zte/) | C300 | unknown | **L2** | B | 2 |
| P0 | [ZTE](../research/olt/zte/) | C600 | unknown | **L2** | B | 2 |
| P1 | [Adtran](../research/olt/adtran/) | SDX-6000 | unknown | **L1** | A | 1 |
| P1 | [Adtran](../research/olt/adtran/) | TA5000 | unknown | **L2** | B | 1 |
| P1 | [C-Data](../research/olt/cdata/) | FD1600 | unknown | **L1** | A | 2 |
| P1 | [Calix](../research/olt/calix/) | E7 | unknown | **L2** | B | 1 |
| P1 | [Calix](../research/olt/calix/) | E9 | unknown | **L1** | A | 1 |
| P1 | [DZS](../research/olt/dzs/) | MXK | unknown | **L1** | C | 1 |
| P1 | [DZS](../research/olt/dzs/) | Velocity-V1 | unknown | **L1** | A | 1 |
| P1 | [VSOL](../research/olt/vsol/) | V1600 | unknown | **L2** | B | 2 |
| P1 | [Zyxel](../research/olt/zyxel/) | IES5206 | unknown | **L1** | A | 1 |
| P2 | [BDCOM](../research/olt/bdcom/) | P3600 | unknown | **L2** | B | 1 |
| P2 | [Ubiquiti](../research/olt/ubiquiti/) | UF-OLT | unknown | **L1** | A | 2 |

## 3. Support Level Definitions

- **Level L1 (Documented)**: Sources and MIB definitions are cataloged in `research/olt/<vendor>/sources.yaml` with valid IANA PEN and confidence grade (A/B/C). Limitations (e.g. UISP RPC vs SNMP, white-label OEM) are published.
- **Level L2 (Simulated)**: A dedicated `OltVendorAdapter` normalizes traps into canonical `TelemetryEvent`s with 100% test coverage over UDP loopback sockets and golden snapshots. Conformance suite passes without physical equipment.
- **Level L3 (Lab Certified)**: Certified against real physical hardware in an isolated staging test bench with controlled alarm/clear cycles.
- **Level L4 (Field Certified)**: Certified on live production ISP networks across multiple firmware builds in observation shadow mode.
