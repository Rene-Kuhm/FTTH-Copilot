# Multi-Vendor OLT Compatibility Matrix

Auto-generated from authoritative vendor sources in `research/olt/`.

## 1. Summary Statistics

- **Total Vendors Registered**: 17
- **Total Hardware Families**: 94
- **Documented Sources**: 92
- **Verified OID Facts**: 152

| Support Level | Hardware Families | Status |
|---|---|---|
| **Level L1 (Documented)** | 72 | Research cataloged, MIBs registered, architectural limits documented |
| **Level L2 (Simulated)** | 22 | Full adapter implemented, synthetic & loopback UDP tests passing |
| **Level L3 (Lab Certified)** | 0 | Physical lab hardware validated with real alarms (Fase 9) |
| **Level L4 (Field Certified)** | 0 | Live production certified with zero false-positives (Fase 9) |

## 2. Canonical Compatibility Table

| Priority | Vendor | Family / Series | Firmware | Level | Grade | Sources |
|---|---|---|---|---|---|---|
| P0 | [FiberHome](../research/olt/fiberhome/) | AN5116-06B | unknown | **L1** | B | 1 |
| P0 | [FiberHome](../research/olt/fiberhome/) | AN5516 | unknown | **L2** | B | 3 |
| P0 | [FiberHome](../research/olt/fiberhome/) | AN5516-01 | unknown | **L1** | A | 1 |
| P0 | [FiberHome](../research/olt/fiberhome/) | AN6000 | unknown | **L2** | B | 3 |
| P0 | [Huawei](../research/olt/huawei/) | HN8245Q | undefined | **L1** | B | 1 |
| P0 | [Huawei](../research/olt/huawei/) | MA5600 | unknown | **L2** | B | 2 |
| P0 | [Huawei](../research/olt/huawei/) | MA5600T | V800R019 | **L1** | A | 1 |
| P0 | [Huawei](../research/olt/huawei/) | MA5603T | V800R019 | **L1** | A | 1 |
| P0 | [Huawei](../research/olt/huawei/) | MA5683T | V800R019 | **L1** | A | 1 |
| P0 | [Huawei](../research/olt/huawei/) | MA5800-X15 | V100R019 | **L2** | A | 2 |
| P0 | [Huawei](../research/olt/huawei/) | MA5800-X17 | V100R019 | **L2** | A | 2 |
| P0 | [Huawei](../research/olt/huawei/) | MA5800-X2 | V100R019 | **L2** | A | 1 |
| P0 | [Huawei](../research/olt/huawei/) | MA5800-X7 | V100R019 | **L2** | A | 2 |
| P0 | [Nokia](../research/olt/nokia/) | 7360-ISAM-FX-16 | unknown | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | 7360-ISAM-FX-4 | unknown | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | 7360-ISAM-FX-8 | unknown | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | 7362-ISAM-DF-16GW | unknown | **L1** | B | 1 |
| P0 | [Nokia](../research/olt/nokia/) | Lightspan-FX-16 | FemtoApp | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | Lightspan-FX-4 | FemtoApp | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | Lightspan-FX-8 | FemtoApp | **L2** | A | 1 |
| P0 | [Nokia](../research/olt/nokia/) | Lightspan-MF | unknown | **L2** | A | 1 |
| P0 | [Standards](../research/olt/standards/) | 50G-PON | G.9804-amd1 | **L1** | A | 1 |
| P0 | [Standards](../research/olt/standards/) | OMCI | G.988-amd2 | **L1** | A | 1 |
| P0 | [Standards](../research/olt/standards/) | TR-142 | v2.0 | **L1** | A | 1 |
| P0 | [Standards](../research/olt/standards/) | TR-451 | v1.0 | **L1** | A | 1 |
| P0 | [Standards](../research/olt/standards/) | USP | v1.1 | **L1** | A | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C300 | unknown | **L1** | B | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C320 | unknown | **L1** | B | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C600 | TITAN | **L2** | A | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C610 | unknown | **L1** | A | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C610E | unknown | **L1** | A | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C620 | TITAN | **L2** | A | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C650 | TITAN | **L2** | A | 1 |
| P0 | [ZTE](../research/olt/zte/) | ZXA10-C680 | TITAN | **L2** | A | 1 |
| P1 | [Adtran](../research/olt/adtran/) | SDX-6000 | unknown | **L1** | A | 1 |
| P1 | [Adtran](../research/olt/adtran/) | SDX-6320 | unknown | **L1** | A | 1 |
| P1 | [Adtran](../research/olt/adtran/) | TA1148 | undefined | **L1** | B | 1 |
| P1 | [Adtran](../research/olt/adtran/) | TA5000 | unknown | **L2** | B | 1 |
| P1 | [C-Data](../research/olt/cdata/) | FD1104SN | undefined | **L1** | B | 1 |
| P1 | [C-Data](../research/olt/cdata/) | FD1600 | unknown | **L1** | A | 2 |
| P1 | [C-Data](../research/olt/cdata/) | FD1604E-C1 | unknown | **L1** | A | 1 |
| P1 | [C-Data](../research/olt/cdata/) | FD1604S | unknown | **L1** | A | 1 |
| P1 | [C-Data](../research/olt/cdata/) | FD1700S | unknown | **L1** | A | 1 |
| P1 | [C-Data](../research/olt/cdata/) | FD1801S-C1 | unknown | **L1** | A | 1 |
| P1 | [C-Data](../research/olt/cdata/) | FD6700S | unknown | **L1** | A | 1 |
| P1 | [Calix](../research/olt/calix/) | 844G-1 | undefined | **L1** | A | 2 |
| P1 | [Calix](../research/olt/calix/) | 844G-2 | AXOS | **L1** | A | 1 |
| P1 | [Calix](../research/olt/calix/) | 844GE-2 | AXOS | **L1** | A | 1 |
| P1 | [Calix](../research/olt/calix/) | B6-002 | AXOS | **L1** | A | 1 |
| P1 | [Calix](../research/olt/calix/) | B6-006 | AXOS | **L1** | A | 1 |
| P1 | [Calix](../research/olt/calix/) | E3-2 | AXOS | **L1** | A | 1 |
| P1 | [Calix](../research/olt/calix/) | E3-48C | E7-OS-R2.5 | **L1** | A | 1 |
| P1 | [Calix](../research/olt/calix/) | E5-48C | E7-OS-R2.5 | **L1** | A | 1 |
| P1 | [Calix](../research/olt/calix/) | E7 | unknown | **L2** | B | 1 |
| P1 | [Calix](../research/olt/calix/) | E9 | unknown | **L1** | A | 1 |
| P1 | [Cisco](../research/olt/cisco/) | NCS-1001 | IOS-XR-7.9.1 | **L1** | A | 1 |
| P1 | [Cisco](../research/olt/cisco/) | NCS-1010 | IOS-XR-7.9.1 | **L1** | A | 1 |
| P1 | [Cisco](../research/olt/cisco/) | NCS-1020 | IOS-XR-7.9.1 | **L1** | A | 1 |
| P1 | [DZS](../research/olt/dzs/) | MXK-194 | unknown | **L1** | B | 1 |
| P1 | [DZS](../research/olt/dzs/) | MXK-319 | unknown | **L1** | A | 2 |
| P1 | [DZS](../research/olt/dzs/) | MXK-819 | unknown | **L1** | A | 1 |
| P1 | [DZS](../research/olt/dzs/) | MXK-823 | unknown | **L1** | A | 1 |
| P1 | [DZS](../research/olt/dzs/) | Velocity-V14 | sdNOS | **L1** | B | 1 |
| P1 | [DZS](../research/olt/dzs/) | Velocity-V16 | sdNOS | **L1** | B | 1 |
| P1 | [DZS](../research/olt/dzs/) | Velocity-V6 | sdNOS | **L1** | A | 2 |
| P1 | [Edgecore](../research/olt/edgecore/) | ASGvOLT64 | unknown | **L1** | A | 1 |
| P1 | [Edgecore](../research/olt/edgecore/) | ASXvOLT16 | unknown | **L1** | A | 2 |
| P1 | [VSOL](../research/olt/vsol/) | V1600 | unknown | **L2** | B | 2 |
| P1 | [VSOL](../research/olt/vsol/) | V1600XG02 | unknown | **L1** | A | 1 |
| P1 | [VSOL](../research/olt/vsol/) | V2801RH | undefined | **L1** | A | 1 |
| P1 | [VSOL](../research/olt/vsol/) | V2802RH | undefined | **L1** | A | 1 |
| P1 | [VSOL](../research/olt/vsol/) | V2902A | undefined | **L1** | A | 1 |
| P1 | [VSOL](../research/olt/vsol/) | V2905H | undefined | **L1** | A | 1 |
| P1 | [VSOL](../research/olt/vsol/) | V3600G1-C | unknown | **L1** | A | 1 |
| P1 | [Zyxel](../research/olt/zyxel/) | IES4204 | unknown | **L1** | A | 1 |
| P1 | [Zyxel](../research/olt/zyxel/) | IES5206 | unknown | **L1** | A | 1 |
| P1 | [Zyxel](../research/olt/zyxel/) | IES5212 | unknown | **L1** | A | 1 |
| P1 | [Zyxel](../research/olt/zyxel/) | OLT1404B | unknown | **L1** | A | 1 |
| P1 | [Zyxel](../research/olt/zyxel/) | OLT1408B | unknown | **L1** | A | 1 |
| P1 | [Zyxel](../research/olt/zyxel/) | OLT2404 | unknown | **L1** | A | 1 |
| P1 | [Zyxel](../research/olt/zyxel/) | OLT2406 | unknown | **L1** | A | 1 |
| P2 | [BDCOM](../research/olt/bdcom/) | P3310B | unknown | **L1** | B | 1 |
| P2 | [BDCOM](../research/olt/bdcom/) | P3310C | unknown | **L1** | B | 1 |
| P2 | [BDCOM](../research/olt/bdcom/) | P3600 | unknown | **L2** | B | 1 |
| P2 | [BDCOM](../research/olt/bdcom/) | P5816-24T | undefined | **L1** | B | 1 |
| P2 | [Ericsson](../research/olt/ericsson/) | EDA-1500 | R7.0 | **L1** | B | 1 |
| P2 | [Raisecom](../research/olt/raisecom/) | ISCOM5508-GP | unknown | **L1** | A | 1 |
| P2 | [Raisecom](../research/olt/raisecom/) | ISCOM6800 | unknown | **L1** | B | 1 |
| P2 | [Raisecom](../research/olt/raisecom/) | ISCOM6820-GP | unknown | **L1** | A | 1 |
| P2 | [Raisecom](../research/olt/raisecom/) | ISCOM6860 | unknown | **L1** | A | 1 |
| P2 | [Ubiquiti](../research/olt/ubiquiti/) | UF-LOCO | UFiber | **L1** | A | 1 |
| P2 | [Ubiquiti](../research/olt/ubiquiti/) | UF-NANO | UFiber | **L1** | A | 1 |
| P2 | [Ubiquiti](../research/olt/ubiquiti/) | UFiber | unknown | **L1** | A | 1 |
| P2 | [Ubiquiti](../research/olt/ubiquiti/) | UISP-Fiber-OLT-XGS | UISP | **L1** | A | 2 |

## 3. Support Level Definitions

- **Level L1 (Documented)**: Sources and MIB definitions are cataloged in `research/olt/<vendor>/sources.yaml` with valid IANA PEN and confidence grade (A/B/C). Limitations (e.g. UISP RPC vs SNMP, white-label OEM) are published.
- **Level L2 (Simulated)**: A dedicated `OltVendorAdapter` normalizes traps into canonical `TelemetryEvent`s with 100% test coverage over UDP loopback sockets and golden snapshots. Conformance suite passes without physical equipment.
- **Level L3 (Lab Certified)**: Certified against real physical hardware in an isolated staging test bench with controlled alarm/clear cycles.
- **Level L4 (Field Certified)**: Certified on live production ISP networks across multiple firmware builds in observation shadow mode.
