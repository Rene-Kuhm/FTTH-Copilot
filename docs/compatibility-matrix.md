# Multi-Vendor OLT Compatibility Matrix

Auto-generated from authoritative vendor sources in `research/olt/`.

## 1. Summary Statistics

- **Total Vendors Registered**: 12
- **Total Hardware Families**: 33
- **Documented Sources**: 41
- **Verified OID Facts**: 77

| Support Level | Hardware Families | Status |
|---|---|---|
| **Level L1 (Documented)** | 10 | Research cataloged, MIBs registered, architectural limits documented |
| **Level L2 (Simulated)** | 23 | Full adapter implemented, synthetic & loopback UDP tests passing |
| **Level L3 (Lab Certified)** | 0 | Physical lab hardware validated with real alarms (Fase 9) |
| **Level L4 (Field Certified)** | 0 | Live production certified with zero false-positives (Fase 9) |

## 2. Canonical Compatibility Table

| Priority | Vendor | Family / Series | Firmware | Level | Grade | Sources |
|---|---|---|---|---|---|---|
| P0 | [FiberHome](../research/olt/fiberhome/) | AN5516 | unknown | **L2** | B | 2 |
| P0 | [FiberHome](../research/olt/fiberhome/) | AN6000 | unknown | **L2** | B | 3 |
| P0 | [Huawei](../research/olt/huawei/) | MA5600 | unknown | **L2** | B | 2 |
| P0 | [Huawei](../research/olt/huawei/) | MA5800 | unknown | **L2** | B | 2 |
| P0 | [Nokia](../research/olt/nokia/) | 7360-ISAM-FX-16 | unknown | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | 7360-ISAM-FX-4 | unknown | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | 7360-ISAM-FX-8 | unknown | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | 7362-ISAM-DF-16GW | unknown | **L1** | B | 1 |
| P0 | [Nokia](../research/olt/nokia/) | Lightspan-FX-16 | FemtoApp | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | Lightspan-FX-4 | FemtoApp | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | Lightspan-FX-8 | FemtoApp | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | Lightspan-MF | unknown | **L2** | A | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C300 | unknown | **L1** | B | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C320 | unknown | **L1** | B | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C600 | TITAN | **L2** | A | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C620 | TITAN | **L2** | A | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C650 | TITAN | **L2** | A | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C680 | TITAN | **L2** | A | 1 |
| P1 | [Adtran](../research/olt/adtran/) | SDX-6000 | unknown | **L1** | A | 1 |
| P1 | [Adtran](../research/olt/adtran/) | TA5000 | unknown | **L2** | B | 1 |
| P1 | [C-Data](../research/olt/cdata/) | FD1600 | unknown | **L1** | A | 2 |
| P1 | [Calix](../research/olt/calix/) | E7 | unknown | **L2** | B | 1 |
| P1 | [Calix](../research/olt/calix/) | E9 | unknown | **L1** | A | 1 |
| P1 | [DZS](../research/olt/dzs/) | MXK-319 | unknown | **L2** | A | 2 |
| P1 | [DZS](../research/olt/dzs/) | MXK-819 | unknown | **L2** | A | 1 |
| P1 | [DZS](../research/olt/dzs/) | MXK-823 | unknown | **L2** | A | 1 |
| P1 | [DZS](../research/olt/dzs/) | Velocity-V16 | sdNOS | **L1** | B | 1 |
| P1 | [DZS](../research/olt/dzs/) | Velocity-V6 | sdNOS | **L2** | A | 2 |
| P1 | [VSOL](../research/olt/vsol/) | V1600 | unknown | **L2** | B | 2 |
| P1 | [Zyxel](../research/olt/zyxel/) | IES5206 | unknown | **L1** | A | 1 |
| P2 | [BDCOM](../research/olt/bdcom/) | P3600 | unknown | **L2** | B | 1 |
| P2 | [Ubiquiti](../research/olt/ubiquiti/) | UFiber | unknown | **L1** | A | 1 |
| P2 | [Ubiquiti](../research/olt/ubiquiti/) | UISP-Fiber-OLT-XGS | UISP | **L1** | A | 2 |

## 3. Support Level Definitions

- **Level L1 (Documented)**: Sources and MIB definitions are cataloged in `research/olt/<vendor>/sources.yaml` with valid IANA PEN and confidence grade (A/B/C). Limitations (e.g. UISP RPC vs SNMP, white-label OEM) are published.
- **Level L2 (Simulated)**: A dedicated `OltVendorAdapter` normalizes traps into canonical `TelemetryEvent`s with 100% test coverage over UDP loopback sockets and golden snapshots. Conformance suite passes without physical equipment.
- **Level L3 (Lab Certified)**: Certified against real physical hardware in an isolated staging test bench with controlled alarm/clear cycles.
- **Level L4 (Field Certified)**: Certified on live production ISP networks across multiple firmware builds in observation shadow mode.
