# Calix, Adtran, DZS and Zyxel OLT Vendor Adapters Specification

## ADDED Requirements

### Requirement 1: Calix Optical Hierarchy, Serial and Event Extraction
The Calix adapter SHALL extract optical topology indexes (`shelf`, `slot`, `port`, `ontId`), ONT Serial Number (`CXNK...`), and semantic condition from Calix `e7TrapAlarm` varbinds (`e7TrapCliObject`, `e7TrapText`).
- **Given**: A Calix `e7TrapAlarm` notification with `e7TrapCliObject: "ont 1/1/2/4"` and `e7TrapText: "Loss of Signal"`, and serial `CXNK00123456`.
- **When**: `CalixOltAdapter.normalize()` executes.
- **Then**: `deviceKind` is `'ONU'`, `deviceId` is `'CXNK00123456'`, and `metrics` contains `shelf: 1`, `slot: 1`, `port: 2`, `onuId: 4`, and `serial: 'CXNK00123456'`.

### Requirement 2: Separation of Calix E7 and E9/AXOS Architectures
The Calix adapter SHALL restrict its specialized MIB parsing to the E7 family (`E7-2`, `E7-20`) and SHALL NOT assume a common MIB with E9/AXOS platforms.
- **Given**: A notification from an E9/AXOS device or non-E7 enterprise branch.
- **When**: `CalixOltAdapter.supports()` is evaluated.
- **Then**: If the device identity indicates an E9 or AXOS platform, the adapter returns `false`, safely abstaining and allowing baseline standard processing without generating fabricated diagnostics.

### Requirement 3: Adtran GPON Hierarchy and Serial Extraction
The Adtran adapter SHALL extract optical topology indexes (`slot`, `port`, `onuId`), ONT Serial Number (`ADTN...`), and interface description from `ADTRAN-GENGPON-MIB` notifications and varbinds (`ifDescr`, `ifIndex`).
- **Given**: An Adtran `adGenGponOntDyingGaspAlarm` notification with `ifDescr: "ont 1/2.8"` and serial `ADTN12345678`.
- **When**: `AdtranOltAdapter.normalize()` executes.
- **Then**: `deviceKind` is `'ONU'`, `deviceId` is `'ADTN12345678'`, `metrics` contains `slot: 1`, `port: 2`, `onuId: 8`, and `serial: 'ADTN12345678'`.

### Requirement 4: Separation of Adtran TA5000 and SDX-6000/Mosaic
The Adtran adapter SHALL restrict its specialized MIB parsing to TA5000 family hardware and SHALL NOT assume common MIB structures with SDX-6000 / Mosaic platforms.
- **Given**: A notification from an SDX-6000 or Mosaic platform.
- **When**: `AdtranOltAdapter.supports()` is evaluated.
- **Then**: If the device identity indicates an SDX-6000 platform, the adapter returns `false`, preventing invalid MIB assumptions.

### Requirement 5: Alarm and Recovery (Clear) Pairing
Both Calix and Adtran adapters SHALL correctly recognize recovery traps and mark them with `isClear: true` and the corresponding cleared alarm category:
- Calix: `e7TrapAlarmClear` or clear-text alarm clears `los`.
- Adtran: `adGenGponOntOnline` clears `onu_offline`; `adGenGponOntLosClear` clears `los`; `adGenGponPonUp` clears `pon_down`.
- **Given**: An incoming `adGenGponOntOnline` or `adGenGponOntLosClear` trap.
- **When**: The adapter normalizes the trap.
- **Then**: `metrics.isClear` is `true`, `metrics.clearsCategory` indicates the resolved alarm, and `metrics.severity` is `'info'`.

### Requirement 6: Port and Chassis Device Scoping
When a PON-level or card-level trap (`pon_down`, `card_failure`) arrives without an ONT identifier, the adapter SHALL classify `deviceKind` as `'OLT'`, retaining the OLT device identity while attaching the affected port or slot.
- **Given**: A trap indicating PON down on Port 3.
- **When**: The adapter processes the notification.
- **Then**: `deviceKind` is `'OLT'`, `deviceId` is the registered OLT ID, and `metrics.port` is 3.

### Requirement 7: Support Level L2 Elevation (Gate 5)
Calix (`E7`) and Adtran (`TA5000`) SHALL have verified research records, test fixtures, and simulated binary test suites achieving Support Level L2. DZS and Zyxel SHALL maintain complete source inventories at Level L1 with verified IANA PENs.
- **Given**: The research registries for Calix, Adtran, DZS, and Zyxel.
- **When**: `pnpm check:sources` and `pnpm generate:matrix` execute.
- **Then**: Validation succeeds with zero errors, Calix E7 and Adtran TA5000 show Level L2, and DZS and Zyxel show Level L1.
