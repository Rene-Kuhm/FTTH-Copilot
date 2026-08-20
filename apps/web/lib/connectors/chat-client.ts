/**
 * Chat-time connector factory.
 * Picks the user's first NMS connection for the tenant, decrypts the key,
 * and constructs a SmartOltClient for the agent to use.
 *
 * If no real connector is configured, returns null (caller falls back to mock).
 */
import { prisma, decryptApiKey } from '@ftth-copilot/db';
import { SmartOltClient } from '@ftth-copilot/connectors-smartolt';
import type { INmsConnector } from '@ftth-copilot/connectors-core';

type ConnectorInput = ConstructorParameters<typeof SmartOltClient>[0];

export class ChatOltClient extends SmartOltClient implements INmsConnector {
  constructor(input: ConnectorInput) {
    super(input);
  }

  /**
   * Build the connector for a tenant's chat session.
   * - If they have a real SmartOLT connection: use it with useMock: false.
   * - If they have a Mikrowisp connection: use SmartOLT mock (TODO: real adapter).
   * - If they have nothing: return null (caller falls back to mock).
   */
  static async forTenant(tenantId: string): Promise<INmsConnector | null> {
    const conn = await prisma.nmsConnection.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    if (!conn) return null;

    if (conn.provider === 'SMARTOLT') {
      const apiKey = decryptApiKey(conn.encryptedKey, conn.encryptionMeta);
      return new ChatOltClient({
        useMock: false,
        apiKey,
        apiBaseUrl: conn.baseUrl ?? undefined,
      });
    }
    return null;
  }
}
