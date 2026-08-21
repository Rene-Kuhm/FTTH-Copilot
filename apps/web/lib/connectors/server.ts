/**
 * Connector management — server-side helpers.
 * CRUD for NMS connections (SmartOLT, Mikrowisp, NetSense) per tenant.
 *
 * NMS API keys are encrypted at rest (AES-256-GCM, KMS_MASTER_KEY derived).
 */
import { prisma, encryptApiKey } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

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
  provider: 'SMARTOLT' | 'MIKROWISP';
  label: string;
  apiKey: string;
  baseUrl: string;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  // Privilege guard: only roles with manage_connectors may create connectors.
  if (!hasPermission(user.role, 'manage_connectors')) return null;

  const { encryptedKey, iv } = encryptApiKey(input.apiKey);

  const created = await prisma.nmsConnection.create({
    data: {
      tenantId: user.tenantId,
      provider: input.provider,
      label: input.label,
      baseUrl: input.baseUrl,
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
  // Privilege guard: only roles with manage_connectors may delete connectors.
  if (!hasPermission(user.role, 'manage_connectors')) return null;
  const result = await prisma.nmsConnection.deleteMany({
    where: { id, tenantId: user.tenantId },
  });
  return result.count > 0;
}
