import {
  createManagedSnmpReceiver,
  parseAndNormalizeSnmpTrap,
  type SnmpSenderRegistration,
  type RawSnmpEvidenceEnvelope,
} from '@ftth-copilot/monitoring';
import {
  recordError as recordSchedulerError,
  recordSuccess as recordSchedulerSuccess,
  markExpected as markSchedulerExpected,
  markNotExpected as markSchedulerNotExpected,
  recordSnmpBound,
} from './scheduler-health';

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface SnmpReceiverOptions {
  registrations?: SnmpSenderRegistration[];
  onEvent?: (event: unknown) => void;
  onEvidence?: (evidence: RawSnmpEvidenceEnvelope) => void;
  onError?: (error: Error) => void;
}

/**
 * Starts an SNMP UDP trap receiver in observation mode (Roadmap Fase 6 & Fase 0).
 *
 * Disabled unless SNMP_RECEIVER_ENABLED=true, so dev, test and default environments
 * never bind a socket without explicit intent (Roadmap Rule 10).
 */
export function startSnmpReceiver(opts: SnmpReceiverOptions = {}): () => void {
  if (process.env['SNMP_RECEIVER_ENABLED'] !== 'true') {
    markSchedulerNotExpected('snmp');
    recordSnmpBound(false);
    return () => {};
  }

  markSchedulerExpected('snmp');
  recordSnmpBound(false);

  // Load registered senders from options or env JSON (Roadmap 6.2)
  let rawRegistrations: SnmpSenderRegistration[] = opts.registrations ?? [];
  if (rawRegistrations.length === 0 && process.env['SNMP_SENDER_REGISTRY_JSON']) {
    try {
      rawRegistrations = JSON.parse(process.env['SNMP_SENDER_REGISTRY_JSON']);
    } catch {
      recordSchedulerError('snmp', 'Failed to parse SNMP_SENDER_REGISTRY_JSON');
    }
  }

  const port = positiveInt(process.env['SNMP_UDP_PORT'], 1162);

  const receiverHandle = createManagedSnmpReceiver({
    port,
    registrations: rawRegistrations,
    guardOptions: {
      maxPayloadBytes: positiveInt(process.env['SNMP_MAX_PAYLOAD_BYTES'], 2048),
      maxEventsPerWindow: positiveInt(process.env['SNMP_MAX_EVENTS_PER_MINUTE'], 1000),
      windowMs: 60000,
      dedupWindowMs: positiveInt(process.env['SNMP_DEDUP_WINDOW_MS'], 5000),
    },
    disableAuthorization: process.env['SNMP_DISABLE_AUTH'] === 'true',
    onNotification: (notification, senderContext, evidence) => {
      try {
        const normalized = parseAndNormalizeSnmpTrap(
          {
            version: notification.version,
            trapOid: notification.trapOid,
            varbinds: notification.varbinds,
            receivedAtMs: notification.receivedAtMs,
            sysUpTime: notification.sysUpTime,
            eventTime: notification.eventTime,
            pduType: notification.pduType,
          },
          senderContext,
        );
        recordSchedulerSuccess('snmp');
        opts.onEvent?.(normalized);
        opts.onEvidence?.(evidence);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        recordSchedulerError('snmp', `parse/normalize failed: ${msg}`);
      }
    },
    onError: (err, sourceIp) => {
      opts.onError?.(err);
      recordSchedulerError('snmp', `receiver error [${sourceIp ?? 'unknown'}]: ${err.message}`);
    },
  });

  recordSnmpBound(true);

  return () => {
    receiverHandle.close();
    recordSnmpBound(false);
  };
}
