/**
 * Connector management — server-side helpers.
 * CRUD for NMS connections (SmartOLT, Mikrowisp, NetSense) per tenant.
 *
 * NMS API keys are encrypted at rest (AES-256-GCM, KMS_MASTER_KEY derived).
 */
import { prisma, encryptApiKey, decryptApiKey } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { NextResponse } from 'next/server';

/** Read-only projection of NmsConnection (no key). */
export function publicConnector(c: { id: string; provider: string; label: string; baseUrl: string | null; status: string; lastCheckedAt: Date | null; lastError: string | null; createdAt: Date }) {
  return {
    id: c.id,
    provider: c.provider,
    label: c.label,
    baseUrl: c.baseUrl,
    status: c.status,
    lastCheckedAt: c.lastCheckedAt,
    lastError: c.lastError,
    createdAt: c.createdAt,
  };
}

async function loadAll(tenantId: string) {
  return prisma.nmsConnection.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function listConnectors() {
  const user = await getCurrentUser();
  if (!user) return { user: null, connectors: [] };
  const all = await loadAll(user.tenantId);
  return { user, connectors: all.map(publicConnector) };
}

export async function createConnector(input: {
  provider: 'SMARTOLT' | 'MIKROWISP' | 'NETSENSE';
  label: string;
  apiKey: string;
  baseUrl?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { encryptedKey, iv } = encryptApiKey(input.apiKey);

  const created = await prisma.nmsConnection.create({
    data: {
      tenantId: user.tenantId,
      provider: input.provider,
      label: input.label,
      baseUrl: input.baseUrl ?? null,
      encryptedKey,
      encryptionMeta: iv,
      status: 'pending',
    },
  });
  return publicConnector(created);
}

export async function deleteConnector(id: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const result = await prisma.nmsConnection.deleteMany({
    where: { id, tenantId: user.tenantId },
  });
  return result.count > 0;
}

export async function getConnectorForChat() {
  const user = await getCurrentUser();
  if (!user) return null;
  return prisma.nmsConnection.findFirst({
    where: { tenantId: user.tenantId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getDecryptedApiKey(encryptedKey: string, iv: string): Promise<string> {
  return decryptApiKey(encryptedKey, iv);
}
