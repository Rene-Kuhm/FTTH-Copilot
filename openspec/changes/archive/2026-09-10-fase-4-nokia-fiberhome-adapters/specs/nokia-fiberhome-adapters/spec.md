# Nokia & FiberHome OLT Vendor Adapters Specification

## ADDED Requirements

### Requirement 1: Nokia Optical Hierarchy and Serial Extraction
The Nokia adapter SHALL extract optical topology indexes (`rack`, `shelf`/subrack, `slot`, `port`, `ontId`) and the ONT Serial Number from Nokia/Alcatel ASAM and Lightspan varbinds and OID instance suffixes.
- **Given**: A Nokia trap containing varbinds or instance suffix specifying Rack 1, Shelf 1, Slot 2, Port 4, ONT 10, and serial `ALCL12345678`.
- **When**: `NokiaOltAdapter.normalize()` executes.
- **Then**: `deviceKind` is set to `'ONU'`, `deviceId` is set to `'ALCL12345678'`, and `metrics` contains `slot: 2`, `port: 4`, `onuId: 10`, and `serial: 'ALCL12345678'`.

### Requirement 2: FiberHome GPON Hierarchy and Serial Extraction
The FiberHome adapter SHALL extract optical topology indexes (`slot`, `port`, `onuId` or `subrack`, `slot`, `port`, `onuId`) and the ONT Serial Number from FH-GPON varbinds and OID instance suffixes.
- **Given**: A FiberHome trap containing varbinds or instance suffix specifying Slot 3, Port 1, ONU 8, and serial `FHTT87654321`.
- **When**: `FiberhomeOltAdapter.normalize()` executes.
- **Then**: `deviceKind` is set to `'ONU'`, `deviceId` is set to `'FHTT87654321'`, and `metrics` contains `slot: 3`, `port: 1`, `onuId: 8`, and `serial: 'FHTT87654321'`.

### Requirement 3: Vendor Serial Number Decoding for Nokia (ALCL/NOKT) and FiberHome (FHTT)
The adapters SHALL decode ASCII and hexadecimal octet strings representing vendor serials with prefixes `ALCL`, `NOKT`, and `FHTT` without truncation or corruption.
- **Given**: A trap varbind with raw hex `414C434C31323334` (`ALCL1234`) or `4648545435363738` (`FHTT5678`).
- **When**: Serial number parsing executes.
- **Then**: It decodes cleanly to `'ALCL1234'` or `'FHTT5678'`.

### Requirement 4: Alarm and Recovery (Clear) Pairing
The adapters SHALL recognize recovery traps (`nokiaOntOnline`, `nokiaOntLosClear`, `nokiaPonPortUp`, `fhGponOntOnline`, `fhGponOntLosClear`, `fhGponPortUp`) and mark them with `isClear: true` and the corresponding cleared alarm category.
- **Given**: An incoming `nokiaOntOnline` or `fhGponOntOnline` trap.
- **When**: The adapter normalizes the trap.
- **Then**: `metrics.isClear` is `true`, `metrics.clearsCategory` indicates the resolved alarm (`'onu_offline'`), and `metrics.severity` is `'info'`.

### Requirement 5: Port and Card Failure Device Scoping
When a port-level or card-level trap (`nokiaPonPortDown`, `nokiaCardFailure`, `fhGponPortDown`, `fhCardFailure`) arrives without an ONT index, the adapter SHALL classify `deviceKind` as `'OLT'`, retaining the OLT device identity while attaching the affected port or slot identifier.
- **Given**: A trap `nokiaPonPortDown` or `fhGponPortDown` on Port 2.
- **When**: The adapter processes the notification.
- **Then**: `deviceKind` is `'OLT'`, `deviceId` is the registered OLT ID, and `metrics.port` is 2.

### Requirement 6: Support Level L2 Achievement (Gate 4)
Both Nokia (`7360-ISAM-FX`, `Lightspan-MF`) and FiberHome (`AN5516`, `AN6000`) SHALL have verified research records, test fixtures, and simulated binary test suites achieving Support Level L2 without invented OIDs.
- **Given**: The research registries for Nokia and FiberHome.
- **When**: `pnpm check:sources` and `pnpm generate:matrix` run.
- **Then**: Both vendors show level L2 with confidence grade A/B for target families.
