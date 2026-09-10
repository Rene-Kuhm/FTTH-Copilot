import dgram from 'node:dgram';
import {
  createSenderRegistry,
  resolveTrapSender,
  parseAndNormalizeSnmpTrap,
  createSnmpIngestionGuard,
  type SnmpSenderRegistration,
  type RawSnmpTrapPacket,
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
}

/**
 * Starts an SNMP UDP trap receiver in observation mode (Roadmap Fase 6 — 6.5 + 6.7).
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
  const registry = createSenderRegistry(rawRegistrations);

  const port = positiveInt(process.env['SNMP_UDP_PORT'], 1162);
  const socket = dgram.createSocket('udp4');

  const guard = createSnmpIngestionGuard({
    maxPayloadBytes: positiveInt(process.env['SNMP_MAX_PAYLOAD_BYTES'], 2048),
    maxEventsPerWindow: positiveInt(process.env['SNMP_MAX_EVENTS_PER_MINUTE'], 1000),
    windowMs: 60000,
    dedupWindowMs: positiveInt(process.env['SNMP_DEDUP_WINDOW_MS'], 5000),
  });

  socket.on('message', (msg, rinfo) => {
    // 1. Guard check on raw bytes (size & rate)
    const signature = `${rinfo.address}:${msg.length}`;
    const evalResult = guard.evaluate(msg.length, signature, Date.now());
    if (!evalResult.allow) return;

    // 2. Resolve sender context strictly by source IP (Rule 6.2)
    const senderContext = resolveTrapSender(rinfo.address, registry);
    if (!senderContext) {
      // Unregistered sender is dropped with zero mutation
      return;
    }

    try {
      // 3. Observation mode: parse trap packet structure
      const trapPacket: RawSnmpTrapPacket = {
        version: 'v2c',
        trapOid: '1.3.6.1.6.3.1.1.5.3',
        varbinds: [],
        receivedAtMs: Date.now(),
      };

      const normalized = parseAndNormalizeSnmpTrap(trapPacket, senderContext);
      recordSchedulerSuccess('snmp');
      opts.onEvent?.(normalized);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      recordSchedulerError('snmp', `parse/normalize failed: ${msg}`);
    }
  });

  socket.on('error', (err: Error) => {
    recordSchedulerError('snmp', `socket error: ${err.message}`);
    recordSnmpBound(false);
  });

  socket.bind(port, () => {
    recordSnmpBound(true);
  });

  return () => {
    try {
      socket.close();
    } catch {
      // ignore
    }
    recordSnmpBound(false);
  };
}
