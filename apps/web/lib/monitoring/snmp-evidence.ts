import { prisma, encryptApiKey, decryptApiKey } from '@ftth-copilot/db';
import type { RawSnmpEvidenceEnvelope, SnmpVarbindDetail } from '@ftth-copilot/monitoring';

/**
 * Storage for raw SNMP trap evidence.
 *
 * Policy, decided deliberately rather than defaulted:
 *
 *   1. Non-identifying varbinds are normalised and stored in plain text. They
 *      are what analysis reads, and they carry no personal data.
 *   2. Identifying varbinds (MAC addresses, ONU serials) are personal data.
 *      They are encrypted at rest with the KMS master key and are dropped
 *      wholesale when a tenant is offboarded.
 *   3. Retention is 90 days, carried per row in `expiresAt` so the purge does
 *      not have to re-derive a policy constant for every row.
 *
 * The raw packet itself is never stored. It is the largest and least useful
 * part: everything needed for forensics is already in the envelope.
 */

/** Retention window agreed for trap evidence. */
export const EVIDENCE_RETENTION_DAYS = 90;

/**
 * OIDs whose values identify a subscriber's equipment.
 *
 * Deliberately narrow: everything else stays readable so an operator can
 * diagnose a trap without a decrypt step.
 */
const IDENTIFYING_OID_PATTERNS: RegExp[] = [
  /mac(address)?/i,
  /serial/i,
  /\bonu.*(sn|serial)\b/i,
  /ifalias/i,
  /ifdescr/i,
];

/** A varbind is identifying when either its OID or its value says so. */
const IDENTIFYING_VALUE_PATTERNS: RegExp[] = [
  /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i, // MAC address
  /^[A-Z]{4}[0-9A-F]{8,12}$/, // ONU serial, e.g. HWTC12345678
];

function isIdentifying(varbind: SnmpVarbindDetail): boolean {
  if (IDENTIFYING_OID_PATTERNS.some((pattern) => pattern.test(varbind.oid))) {
    return true;
  }
  const value = varbind.value;
  if (typeof value !== 'string') return false;
  return IDENTIFYING_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

export interface NormalizedEvidence {
  metadata: {
    evidenceId: string;
    fingerprint: string;
    senderIp: string;
    snmpVersion: string;
    pduType: string;
    trapOid: string;
    sysUpTime: number | null;
    eventTime: Date | null;
    receivedAt: Date;
    expiresAt: Date;
  };
  varbinds: Array<{ oid: string; type: string; value: string | number | boolean | null }>;
  identifyingVars: Array<{ oid: string; value: string }>;
}

export function retentionDeadline(from: Date): Date {
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + EVIDENCE_RETENTION_DAYS);
  return expires;
}

/**
 * Split an envelope into readable and identifying parts.
 *
 * `rawHex` is dropped on purpose: it is the bulk of the payload and adds
 * nothing a normalised value does not already carry.
 */
export function normalizeEvidence(
  envelope: RawSnmpEvidenceEnvelope,
  now = new Date(),
): NormalizedEvidence {
  const varbinds: NormalizedEvidence['varbinds'] = [];
  const identifyingVars: NormalizedEvidence['identifyingVars'] = [];

  for (const varbind of envelope.varbinds) {
    if (isIdentifying(varbind)) {
      identifyingVars.push({ oid: varbind.oid, value: String(varbind.value) });
      // Keep the shape in the readable part so the varbind is not invisible.
      varbinds.push({ oid: varbind.oid, type: varbind.type, value: '[redacted]' });
      continue;
    }
    varbinds.push({ oid: varbind.oid, type: varbind.type, value: varbind.value });
  }

  return {
    metadata: {
      evidenceId: envelope.evidenceId,
      fingerprint: envelope.fingerprint,
      senderIp: envelope.senderIp,
      snmpVersion: envelope.snmpVersion,
      pduType: envelope.pduType,
      trapOid: envelope.trapOid,
      sysUpTime: envelope.sysUpTime,
      eventTime: envelope.eventTime ? new Date(envelope.eventTime) : null,
      receivedAt: new Date(envelope.receivedAt),
      expiresAt: retentionDeadline(now),
    },
    varbinds,
    identifyingVars,
  };
}

/**
 * Persist one trap's evidence.
 *
 * Idempotent on (tenantId, evidenceId): a redelivered trap updates the existing
 * row rather than failing, because the unique index is the guard and a duplicate
 * trap is not an error worth surfacing.
 */
export async function storeEvidence(
  tenantId: string,
  envelope: RawSnmpEvidenceEnvelope,
  now = new Date(),
): Promise<void> {
  const normalized = normalizeEvidence(envelope, now);

  const identifyingVarsEncrypted =
    normalized.identifyingVars.length > 0
      ? encryptApiKey(JSON.stringify(normalized.identifyingVars)).encryptedKey
      : null;

  await prisma.snmpEvidence.upsert({
    where: {
      tenantId_evidenceId: {
        tenantId,
        evidenceId: normalized.metadata.evidenceId,
      },
    },
    create: {
      tenantId,
      ...normalized.metadata,
      varbinds: normalized.varbinds as object,
      identifyingVarsEncrypted,
    },
    update: {
      receivedAt: normalized.metadata.receivedAt,
      expiresAt: normalized.metadata.expiresAt,
      varbinds: normalized.varbinds as object,
      identifyingVarsEncrypted,
    },
  });
}

/** Delete evidence past its retention boundary. Returns rows removed. */
export async function purgeExpiredEvidence(now = new Date()): Promise<number> {
  const result = await prisma.snmpEvidence.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return result.count;
}

/**
 * Drop every trace of a tenant's evidence.
 *
 * Intended for offboarding. The table also cascades on tenant deletion, so this
 * exists for the path where a client leaves but the tenant record stays for
 * billing history.
 */
export async function purgeTenantEvidence(tenantId: string): Promise<number> {
  const result = await prisma.snmpEvidence.deleteMany({ where: { tenantId } });
  return result.count;
}

/** Read back the identifying varbinds of one evidence row. */
export function readIdentifyingVars(row: {
  identifyingVarsEncrypted: string | null;
}): Array<{ oid: string; value: string }> {
  if (!row.identifyingVarsEncrypted) return [];
  return JSON.parse(decryptApiKey(row.identifyingVarsEncrypted)) as Array<{
    oid: string;
    value: string;
  }>;
}