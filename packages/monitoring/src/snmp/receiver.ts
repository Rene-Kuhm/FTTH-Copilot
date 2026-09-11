/**
 * Managed SNMP Receiver Service (Roadmap Fase 0).
 *
 * Coordinates:
 * - Net-SNMP RFC-compliant ASN.1/BER decoding and USM authentication (RFC 3414).
 * - Pre-parse Ingestion Guard (max payload size, rate-limiting) on raw UDP bytes.
 * - Sender IP lookup against authorized sender registry (drops unregistered IPs before BER parsing).
 * - Automatic Inform acknowledgment response over UDP (RFC 3416 / RFC 1905).
 * - Timestamp separation (receivedAt, sysUpTime, eventTime).
 * - Canonical fingerprint deduplication.
 * - Redacted raw evidence envelope emission.
 */

import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import * as snmp from 'net-snmp';
import { createSnmpIngestionGuard, type SnmpGuardMetrics, type SnmpGuardOptions, type SnmpIngestionGuard } from './guard';
import {
  checkSenderSecurity,
  createSenderRegistry,
  resolveTrapSender,
  type SnmpSenderContext,
  type SnmpSenderRegistration,
  type SnmpSenderRegistry,
} from './mapping';
import { decodeSnmpTrap } from './decoder';
import { createRawEvidenceEnvelope } from './evidence';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from './types';
import { type TelemetryEvent } from '@ftth-copilot/shared';
import type { OltAdapterRegistry } from './adapter/registry';
import type { ResolvedDeviceIdentity } from './identity';
import { processSnmpNotification } from './pipeline';

export interface ManagedSnmpReceiverOptions {
  port?: number;
  address?: string;
  registrations?: SnmpSenderRegistration[];
  guardOptions?: SnmpGuardOptions;
  disableAuthorization?: boolean;
  adapterRegistry?: OltAdapterRegistry;
  onNotification?: (
    notification: DecodedSnmpNotification,
    senderContext: SnmpSenderContext,
    evidence: RawSnmpEvidenceEnvelope,
  ) => void;
  onTelemetryEvent?: (
    event: TelemetryEvent,
    evidence: RawSnmpEvidenceEnvelope,
    identity: ResolvedDeviceIdentity,
  ) => void;
  onError?: (error: Error, sourceIp?: string) => void;
  onSecurityNotice?: (notice: string) => void;
}

export interface ManagedSnmpReceiverHandle {
  close: (callback?: () => void) => void;
  getGuardMetrics: () => SnmpGuardMetrics;
  getRegistry: () => SnmpSenderRegistry;
}

interface NetSnmpAuthorizer {
  addCommunity: (community: string) => void;
  addUser: (user: {
    name: string;
    level: number;
    authProtocol?: number;
    authKey?: string;
    privProtocol?: number;
    privKey?: string;
  }) => void;
}

interface NetSnmpReceiverInstance {
  close: (callback?: () => void) => void;
  getAuthorizer: () => NetSnmpAuthorizer;
}

type CreateReceiverFn = (
  options: {
    port?: number;
    address?: string;
    transport?: string;
    disableAuthorization?: boolean;
    dgramModule?: unknown;
  },
  callback: (error: Error | null, trap: unknown) => void,
) => NetSnmpReceiverInstance;

function extractCommunityFromSnmpBuffer(buf: Buffer): string | undefined {
  if (buf.length < 6 || buf[0] !== 0x30) return undefined;
  let offset = 1;
  if (buf[offset]! & 0x80) {
    offset += (buf[offset]! & 0x7f) + 1;
  } else {
    offset += 1;
  }
  if (offset >= buf.length || buf[offset] !== 0x02) return undefined;
  const verLen = buf[offset + 1] ?? 0;
  offset += 2 + verLen;
  if (offset >= buf.length || buf[offset] !== 0x04) return undefined;
  const commLen = buf[offset + 1] ?? 0;
  offset += 2;
  if (buf.length < offset + commLen) return undefined;
  return buf.toString('utf8', offset, offset + commLen);
}

export function createManagedSnmpReceiver(
  options: ManagedSnmpReceiverOptions = {},
): ManagedSnmpReceiverHandle {
  const port = options.port ?? 1162;
  const address = options.address ?? '0.0.0.0';
  const registrations = options.registrations ?? [];
  const senderRegistry = createSenderRegistry(registrations);
  const guard: SnmpIngestionGuard = createSnmpIngestionGuard(options.guardOptions);
  const clientCommunityMap = new Map<string, string>();

  // Emit security warnings for registrations using plaintext v1/v2c or weak v3
  for (const reg of registrations) {
    const warnings = checkSenderSecurity(reg);
    for (const w of warnings) {
      options.onSecurityNotice?.(w);
    }
  }

  // Intercept raw UDP datagrams before Net-SNMP BER parsing
  const customDgramModule = {
    createSocket: (transport: string) => {
      const rawSocket = dgram.createSocket(transport as dgram.SocketType);
      const proxySocket = new EventEmitter();

      (proxySocket as unknown as Record<string, unknown>)['bind'] = (...args: unknown[]) =>
        (rawSocket.bind as (...a: unknown[]) => void)(...args);
      (proxySocket as unknown as Record<string, unknown>)['close'] = (...args: unknown[]) =>
        (rawSocket.close as (...a: unknown[]) => void)(...args);
      (proxySocket as unknown as Record<string, unknown>)['address'] = () => rawSocket.address();
      (proxySocket as unknown as Record<string, unknown>)['send'] = (...args: unknown[]) =>
        (rawSocket.send as (...a: unknown[]) => void)(...args);

      rawSocket.on('error', (err: Error) => {
        options.onError?.(err);
        proxySocket.emit('error', err);
      });

      rawSocket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        const nowMs = Date.now();

        // 1. Guard check on raw bytes (size & rate limits)
        const preCheck = guard.evaluatePreParse(msg.length, rinfo.address, nowMs);
        if (!preCheck.allow) {
          return;
        }

        // 2. Track extracted community from raw bytes if present
        const comm = extractCommunityFromSnmpBuffer(msg);
        if (comm) {
          clientCommunityMap.set(`${rinfo.address}:${rinfo.port}`, comm);
        }

        // 3. Sender registry lookup: drop unregistered IPs before BER parsing
        const sender = resolveTrapSender(rinfo.address, senderRegistry);
        if (!sender) {
          return;
        }

        // 4. Delegate to Net-SNMP listener for ASN.1/BER decoding & USM auth
        proxySocket.emit('message', msg, rinfo);
      });

      return proxySocket;
    },
  };

  const createReceiver = (snmp as unknown as { createReceiver: CreateReceiverFn }).createReceiver;
  const receiver = createReceiver(
    {
      port,
      address,
      transport: 'udp4',
      disableAuthorization: options.disableAuthorization ?? false,
      dgramModule: customDgramModule,
    },
    (error: Error | null, trap: unknown) => {
      const rawTrap = trap as { rinfo?: { address?: string; port?: number } } | undefined;
      if (error) {
        options.onError?.(error, rawTrap?.rinfo?.address);
        return;
      }

      try {
        const receivedAtMs = Date.now();
        const senderIp = rawTrap?.rinfo?.address ?? '127.0.0.1';
        const clientKey = rawTrap?.rinfo?.address && rawTrap?.rinfo?.port
          ? `${rawTrap.rinfo.address}:${rawTrap.rinfo.port}`
          : undefined;
        const rawPdu = (trap as { pdu?: { community?: string; user?: { name?: string } }; user?: { name?: string } })?.pdu;
        const community = (clientKey ? clientCommunityMap.get(clientKey) : undefined) ?? rawPdu?.community;
        if (clientKey) {
          clientCommunityMap.delete(clientKey);
        }
        const v3User = rawPdu?.user?.name ?? (trap as { user?: { name?: string } })?.user?.name;
        const authContext = community || v3User ? { community, v3User } : undefined;

        const senderReg = typeof senderRegistry.resolveMulti === 'function'
          ? senderRegistry.resolveMulti(senderIp, authContext)
          : senderRegistry.get(senderIp.trim());

        const decoded = decodeSnmpTrap(trap, { receivedAtMs, versionHint: senderReg?.version });
        const senderContext = resolveTrapSender(decoded.senderIp, senderRegistry, authContext);
        if (!senderContext) {
          return;
        }

        // Build raw evidence envelope
        const evidence = createRawEvidenceEnvelope(decoded);

        // Deduplication check using canonical fingerprint
        const dedupResult = guard.evaluateDeduplication(evidence.fingerprint, receivedAtMs);
        if (!dedupResult.allow) {
          return;
        }

        // Emit notification
        options.onNotification?.(decoded, senderContext, evidence);

        // Emit telemetry.v1 event through adapter pipeline
        if (options.onTelemetryEvent) {
          processSnmpNotification(decoded, senderContext, evidence, {
            adapterRegistry: options.adapterRegistry,
            onTelemetryEvent: options.onTelemetryEvent,
          });
        }
      } catch (err: unknown) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        options.onError?.(errorObj, rawTrap?.rinfo?.address);
      }
    },
  );

  // Authorize registered communities and SNMPv3 users
  const authorizer = receiver.getAuthorizer();
  const securityLevelMap = snmp.SecurityLevel as unknown as Record<string, number>;
  const authProtocolMap = snmp.AuthProtocols as unknown as Record<string, number>;
  const privProtocolMap = snmp.PrivProtocols as unknown as Record<string, number>;

  for (const reg of registrations) {
    if (reg.community) {
      authorizer.addCommunity(reg.community);
    }
    if (reg.v3User) {
      const u = reg.v3User;
      const userLevel = securityLevelMap[u.level] ?? snmp.SecurityLevel.noAuthNoPriv;
      const authProto = u.authProtocol ? authProtocolMap[u.authProtocol] : undefined;
      const privProto = u.privProtocol ? privProtocolMap[u.privProtocol] : undefined;

      authorizer.addUser({
        name: u.name,
        level: userLevel,
        authProtocol: authProto,
        authKey: u.authKey,
        privProtocol: privProto,
        privKey: u.privKey,
      });
    }
  }

  return {
    close: (cb?: () => void) => {
      try {
        receiver.close(cb);
      } catch {
        cb?.();
      }
    },
    getGuardMetrics: () => guard.getMetrics(),
    getRegistry: () => senderRegistry,
  };
}
