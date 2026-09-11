export {
  runPollCycle,
  pollConnections,
  type PollMeta,
  type PollEntry,
  type PollCycleOptions,
  type PollCycleResult,
  type PollAllResult,
} from './poll';

export {
  lookupTrapDefinition,
  isKnownTrapOid,
  validateCatalogAdmission,
  KNOWN_TRAP_DEFINITIONS,
  type SnmpTrapDefinition,
  type SnmpTrapCategory,
} from './snmp/catalog';

export {
  createSenderRegistry,
  resolveTrapSender,
  checkSenderSecurity,
  type SnmpSenderContext,
  type SnmpSenderRegistration,
  type SnmpSenderRegistry,
} from './snmp/mapping';

export {
  parseAndNormalizeSnmpTrap,
  type RawSnmpTrapPacket,
  type SnmpVarbind,
} from './snmp/parser';

export {
  createSnmpIngestionGuard,
  computeSnmpNotificationFingerprint,
  type SnmpIngestionGuard,
  type SnmpGuardOptions,
  type SnmpDropReason,
  type SnmpGuardMetrics,
  type SnmpEvaluationResult,
  type SnmpNotificationComponents,
} from './snmp/guard';

export {
  correlateTrapWithIncidents,
  isClearingTrap,
  type ActiveIncidentContext,
  type TrapCorrelationAction,
  type TrapCorrelationOutcome,
  type CorrelateTrapArgs,
} from './snmp/incident-linker';

export {
  decodeSnmpTrap,
  formatVarbindValue,
} from './snmp/decoder';

export {
  createRawEvidenceEnvelope,
} from './snmp/evidence';

export {
  createManagedSnmpReceiver,
  type ManagedSnmpReceiverOptions,
  type ManagedSnmpReceiverHandle,
} from './snmp/receiver';

export {
  sendSnmpTestTrap,
  type SendSnmpTrapOptions,
} from './snmp/test-client';

export {
  IANA_VENDOR_REGISTRY,
  IANA_ENTERPRISE_ROOT,
  STANDARD_MIB2_ROOT,
  SNMP_FRAMEWORK_ROOT,
  extractEnterprisePen,
  resolveVendorByPen,
  resolveVendorByOid,
  isStandardOid,
  type IanaVendorRecord,
} from './snmp/iana-pen';

export {
  SourceGradeSchema,
  LicenseStatusSchema,
  FactStatusSchema,
  FactRecordSchema,
  SourceRecordSchema,
  SourcesFileSchema,
  SupportLevelSchema,
  CompatibilityFamilyRecordSchema,
  VendorCompatibilityRecordSchema,
  type SourceGrade,
  type LicenseStatus,
  type FactStatus,
  type FactRecord,
  type SourceRecord,
  type SourcesFile,
  type SupportLevel,
  type CompatibilityFamilyRecord,
  type VendorCompatibilityRecord,
} from './snmp/research/schema';

export {
  validateSourcesList,
  validateCompatibilityRecord,
  validateCrossVendorRegistry,
  type ValidationIssue,
  type ValidationResult,
  type VendorPackageContent,
} from './snmp/research/validator';

export {
  detectOidConflicts,
  type OidConflictIssue,
  type OidConflictReport,
} from './snmp/research/oid-conflicts';

export type {
  SnmpVersion,
  SnmpPduType,
  SnmpSecurityLevel,
  SnmpAuthProtocol,
  SnmpPrivProtocol,
  SnmpV3UserConfig,
  SnmpVarbindDetail,
  DecodedSnmpNotification,
  RawSnmpEvidenceEnvelope,
} from './snmp/types';

export {
  extractIfMibVarbinds,
  mapIfAdminStatus,
  mapIfOperStatus,
  type ExtractedIfMibData,
  type IfAdminStatus,
  type IfOperStatus,
} from './snmp/extractors/if-mib';

export {
  resolveDeviceIdentity,
  type ResolvedDeviceIdentity,
} from './snmp/identity';

export {
  executeAdapterSafe,
  AdapterSecurityViolationError,
  type OltVendorAdapter,
} from './snmp/adapter/contract';

export { StandardOltAdapter } from './snmp/adapter/standard';
export { HuaweiOltAdapter } from './snmp/adapter/huawei';
export { ZteOltAdapter } from './snmp/adapter/zte';
export { NokiaOltAdapter } from './snmp/adapter/nokia';
export { FiberhomeOltAdapter } from './snmp/adapter/fiberhome';
export { CalixOltAdapter } from './snmp/adapter/calix';
export { AdtranOltAdapter } from './snmp/adapter/adtran';
export { VsolOltAdapter } from './snmp/adapter/vsol';
export { BdcomOltAdapter } from './snmp/adapter/bdcom';
export { GenericXponAdapter } from './snmp/adapter/generic-xpon';

export {
  decodeVendorSerialNumber,
  extractHierarchyFromOid,
  extractHuaweiGponHierarchy,
  extractZteGponHierarchy,
  extractNokiaHierarchy,
  extractFiberhomeGponHierarchy,
  extractCalixHierarchy,
  extractAdtranHierarchy,
  extractVsolHierarchy,
  extractBdcomHierarchy,
  type GponOpticalHierarchy,
  type CalixParsedEvent,
} from './snmp/extractors/vendor-helpers';

export {
  OltAdapterRegistry,
  defaultAdapterRegistry,
} from './snmp/adapter/registry';

export {
  processSnmpNotification,
  type SnmpPipelineOptions,
  type SnmpPipelineResult,
} from './snmp/pipeline';

export {
  fixtureTrapToSendOptions,
  generateSyntheticMalformedBytes,
  type FixtureTrapItem,
  type FixtureVarbind,
} from './snmp/conformance/packet-generator';

export {
  SnmpReplayRunner,
  type ReplayOptions,
  type BurstOptions,
  type ReplaySummary,
} from './snmp/conformance/replay-runner';

export {
  sanitizeSnmpText,
  sanitizeSnmpObject,
  sanitizeSnmpCapture,
  type SnmpSanitizerOptions,
  type SanitizerReport,
} from './snmp/sanitizer';

export {
  loadErrataRegistry,
  evaluateSnmpErrata,
  SnmpErrataRecordSchema,
  ErrataFileSchema,
  type SnmpErrataRecord,
  type SnmpErrataAction,
  type SnmpErrataEvaluation,
} from './snmp/research/errata';

