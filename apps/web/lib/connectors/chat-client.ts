/**
 * Tenant-aware connector factory used by chat, dashboard and alerts.
 * A configured connector is never replaced silently with fixture data.
 *
 * The factory itself moved to `@ftth-copilot/connectors-factory` so the
 * background worker can build connectors the same way the web does. This
 * module keeps the web's public API: every import of
 * `@/lib/connectors/chat-client` keeps working, unchanged.
 */
import { prisma } from '@ftth-copilot/db';
import { SmartOltClient } from '@ftth-copilot/connectors-smartolt';
import {
  buildConnectorFromConnection,
  ConnectorResolutionError,
  type ResolvedConnector,
} from '@ftth-copilot/connectors-factory';

export { buildConnectorFromConnection, ConnectorResolutionError };
export type { ResolvedConnector, ConnectorDataSource } from '@ftth-copilot/connectors-factory';

export async function resolveTenantConnector(input: {
  tenantId: string;
  connectionId?: string | null;
}): Promise<ResolvedConnector> {
  const connection = await prisma.nmsConnection.findFirst({
    where: {
      tenantId: input.tenantId,
      status: 'connected',
      ...(input.connectionId ? { id: input.connectionId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!connection) {
    if (input.connectionId) {
      throw new ConnectorResolutionError(
        'El conector seleccionado no existe, no pertenece al tenant o todavía no fue validado.',
        404,
      );
    }
    if (process.env['NODE_ENV'] !== 'production' && process.env['DEMO_MODE_ENABLED'] === 'true') {
      return {
        connector: new SmartOltClient({ useMock: true }),
        dataSource: {
          mode: 'demo',
          connectionId: null,
          provider: 'SMARTOLT',
          label: 'SmartOLT — datos simulados',
        },
      };
    }
    throw new ConnectorResolutionError(
      'No hay un conector NMS validado. Configurá uno y probá la conexión antes de continuar.',
      409,
    );
  }

  return buildConnectorFromConnection(connection);
}
