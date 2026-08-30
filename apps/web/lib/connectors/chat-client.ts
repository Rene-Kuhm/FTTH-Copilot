/**
 * Tenant-aware connector factory used by chat, dashboard and alerts.
 * A configured connector is never replaced silently with fixture data.
 */
import { prisma, decryptApiKey } from '@ftth-copilot/db';
import { SmartOltClient } from '@ftth-copilot/connectors-smartolt';
import { MikrowispClient } from '@ftth-copilot/connectors-mikrowisp';
import type { INmsConnector } from '@ftth-copilot/connectors-core';

export interface ConnectorDataSource {
  mode: 'live' | 'demo';
  connectionId: string | null;
  provider: 'SMARTOLT' | 'MIKROWISP' | 'NETSENSE';
  label: string;
}

export interface ResolvedConnector {
  connector: INmsConnector;
  dataSource: ConnectorDataSource;
}

export class ConnectorResolutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ConnectorResolutionError';
  }
}

interface ConnectionRecord {
  id: string;
  provider: 'SMARTOLT' | 'MIKROWISP' | 'NETSENSE';
  label: string;
  encryptedKey: string;
  baseUrl: string | null;
}

export function buildConnectorFromConnection(connection: ConnectionRecord): ResolvedConnector {
  if (!connection.baseUrl) {
    throw new ConnectorResolutionError('El conector no tiene una URL base configurada.', 409);
  }

  let secret: string;
  try {
    secret = decryptApiKey(connection.encryptedKey);
  } catch {
    throw new ConnectorResolutionError(
      'No se pudieron descifrar las credenciales del conector. Volvé a configurarlo.',
      409,
    );
  }

  let connector: INmsConnector;
  if (connection.provider === 'SMARTOLT') {
    connector = new SmartOltClient({
      useMock: false,
      apiKey: secret,
      apiBaseUrl: connection.baseUrl,
    });
  } else if (connection.provider === 'MIKROWISP') {
    connector = new MikrowispClient({
      useMock: false,
      token: secret,
      apiBaseUrl: connection.baseUrl,
    });
  } else {
    throw new ConnectorResolutionError(
      'El adaptador de NetSense todavía no está implementado. No se usarán datos simulados.',
      422,
    );
  }

  return {
    connector,
    dataSource: {
      mode: 'live',
      connectionId: connection.id,
      provider: connection.provider,
      label: connection.label,
    },
  };
}

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
