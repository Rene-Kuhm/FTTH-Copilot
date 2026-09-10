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
  type SnmpIngestionGuard,
  type SnmpGuardOptions,
  type SnmpDropReason,
  type SnmpGuardMetrics,
} from './snmp/guard';

export {
  correlateTrapWithIncidents,
  isClearingTrap,
  type ActiveIncidentContext,
  type TrapCorrelationAction,
  type TrapCorrelationOutcome,
  type CorrelateTrapArgs,
} from './snmp/incident-linker';

