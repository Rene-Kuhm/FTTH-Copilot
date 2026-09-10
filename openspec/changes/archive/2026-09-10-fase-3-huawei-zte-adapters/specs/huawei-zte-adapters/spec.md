# Huawei & ZTE OLT Vendor Adapters Specification

## ADDED Requirements

### Requirement 1: Huawei GPON Hierarchy and Serial Extraction
The Huawei adapter SHALL extract optical topology indexes (`frame`, `slot`, `port`, `onuId`) and the ONT Serial Number from HUAWEI-XPON/GPON varbinds and OID instance suffixes.
- **Given**: A Huawei trap containing varbinds or instance suffix specifying Frame 0, Slot 2, Port 1, ONU 14, and serial `HWTC12345678`.
- **When**: `HuaweiOltAdapter.normalize()` executes.
- **Then**: `deviceKind` is set to `'ONU'`, `deviceId` is set to `'HWTC12345678'`, and `metrics` contains `frame: 0`, `slot: 2`, `port: 1`, `onuId: 14`, and `serial: 'HWTC12345678'`.

### Requirement 2: ZTE GPON Hierarchy and Serial Extraction
The ZTE adapter SHALL extract optical topology indexes (`rack`, `shelf`, `slot`, `port`, `onuId`) and the ONT Serial Number from ZX-GPON varbinds and OID instance suffixes.
- **Given**: A ZTE trap containing varbinds or instance suffix specifying Rack 1, Shelf 1, Slot 3, Port 2, ONU 5, and serial `ZTEGC8765432`.
- **When**: `ZteOltAdapter.normalize()` executes.
- **Then**: `deviceKind` is set to `'ONU'`, `deviceId` is set to `'ZTEGC8765432'`, and `metrics` contains `slot: 3`, `port: 2`, `onuId: 5`, and `serial: 'ZTEGC8765432'`.

### Requirement 3: Hex-Encoded Serial Number Decoding
The adapters SHALL decode hexadecimal octet strings representing ASCII vendor serials (e.g., `48575443...` to `HWTC...`, `5A544547...` to `ZTEG...`) without mangling.
- **Given**: A trap varbind with raw hex `4857544331323334`.
- **When**: Serial number parsing executes.
- **Then**: It decodes cleanly to `'HWTC1234'`.

### Requirement 4: Alarm and Recovery (Clear) Pairing
The adapters SHALL recognize recovery traps (`hwGponOntOnline`, `hwGponOntLosClear`, `zxGponOntOnline`, `zxGponOntLosClear`) and mark them with `isClear: true` and the corresponding cleared alarm category.
- **Given**: An incoming `hwGponOntOnline` or `zxGponOntOnline` trap.
- **When**: The adapter normalizes the trap.
- **Then**: `metrics.isClear` is `true`, `metrics.clearsCategory` indicates the resolved alarm (e.g. `'los'` or `'offline'`), and `metrics.severity` is `'info'`.

### Requirement 5: PON Port Failure Scoping
When a port-level trap (`hwGponPortDown`, `zxGponPortDown`) arrives without an ONU index, the adapter SHALL classify `deviceKind` as `'OLT'`, retaining the OLT device identity while attaching the affected port identifier.
- **Given**: A trap `hwGponPortDown` on Frame 0, Slot 1, Port 4.
- **When**: The adapter processes the notification.
- **Then**: `deviceKind` is `'OLT'`, `deviceId` is the registered OLT ID, and `metrics.port` is 4.

### Requirement 6: Support Level L2 Achievement
Both Huawei (`MA5600`, `MA5800`) and ZTE (`C300`, `C600`) SHALL have verified research records, test fixtures, and simulated binary test suites achieving Support Level L2.
- **Given**: The research registries for Huawei and ZTE.
- **When**: `pnpm check:sources` and `pnpm generate:matrix` run.
- **Then**: Both vendors show level L2 with confidence grade A/B for target families.
