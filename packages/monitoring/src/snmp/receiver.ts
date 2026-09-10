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

export interface ManagedSnmpReceiverOptions {
  port?: number;
  address?: string;
  registrations?: SnmpSenderRegistration[];
  guardOptions?: SnmpGuardOptions;
  disableAuthorization?: boolean;
  onNotification?: (
    notification: DecodedSnmpNotification,
    senderContext: SnmpSenderContext,
    evidence: RawSnmpEvidenceEnvelope,
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

export function createManagedSnmpReceiver(
  options: ManagedSnmpReceiverOptions = {},
): ManagedSnmpReceiverHandle {
  const port = options.port ?? 1162;
  const address = options.address ?? '0.0.0.0';
  const registrations = options.registrations ?? [];
  const senderRegistry = createSenderRegistry(registrations);
  const guard: SnmpIngestionGuard = createSnmpIngestionGuard(options.guardOptions);

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

        // 2. Sender registry lookup: drop unregistered IPs before BER parsing
        const sender = resolveTrapSender(rinfo.address, senderRegistry);
        if (!sender) {
          return;
        }

        // 3. Delegate to Net-SNMP listener for ASN.1/BER decoding & USM auth
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
      const rawTrap = trap as { rinfo?: { address?: string } } | undefined;
      if (error) {
        options.onError?.(error, rawTrap?.rinfo?.address);
        return;
      }

      try {
        const receivedAtMs = Date.now();
        const senderIp = rawTrap?.rinfo?.address ?? '127.0.0.1';
        const senderReg = senderRegistry.get(senderIp.trim());
        const decoded = decodeSnmpTrap(trap, { receivedAtMs, versionHint: senderReg?.version });
        const senderContext = resolveTrapSender(decoded.senderIp, senderRegistry);
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
