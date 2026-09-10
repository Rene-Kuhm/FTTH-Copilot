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
