/**
 * Raw SNMP Evidence Envelope & Redaction (Roadmap Fase 0).
 *
 * Implements immutable evidence preservation per RFC 3877 / Roadmap Fase 0:
 * - Credentials (community strings, USM keys, passwords) are NEVER exposed.
 * - Retains raw varbinds, OIDs, types, and timestamps (sysUpTime, receivedAt, eventTime).
 */

import crypto from 'node:crypto';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope, SnmpVarbindDetail } from './types';
import { computeSnmpNotificationFingerprint } from './guard';

export function createRawEvidenceEnvelope(
  notification: DecodedSnmpNotification,
): RawSnmpEvidenceEnvelope {
  const receivedAt = new Date(notification.receivedAtMs).toISOString();
  const evidenceId = crypto.randomUUID();

  // Sanitize varbinds: ensure stringified values do not retain binary objects or credentials
  const sanitizedVarbinds: SnmpVarbindDetail[] = notification.varbinds.map((vb) => {
    let value = vb.value;
    if (Buffer.isBuffer(value)) {
      const isAscii = /^[\x20-\x7E]*$/.test(value.toString('binary'));
      value = isAscii ? value.toString('utf8') : value.toString('hex');
    }
    return {
      oid: vb.oid,
      type: vb.type ?? 'Unknown',
      value: (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') ? value : String(value),
      rawHex: vb.rawHex,
    };
  });

  const fingerprint = computeSnmpNotificationFingerprint({
    senderIp: notification.senderIp,
    version: notification.version,
    requestId: notification.requestId,
    trapOid: notification.trapOid,
    varbinds: sanitizedVarbinds,
    sysUpTime: notification.sysUpTime,
  });

  return {
    evidenceId,
    receivedAt,
    senderIp: notification.senderIp,
    senderPort: notification.senderPort,
    snmpVersion: notification.version,
    pduType: notification.pduType,
    trapOid: notification.trapOid,
    sysUpTime: notification.sysUpTime ?? null,
    eventTime: notification.eventTime ?? null,
    varbinds: Object.freeze(sanitizedVarbinds),
    credentialsRedacted: true,
    fingerprint,
  };
}
