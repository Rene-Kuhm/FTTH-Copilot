import Anthropic from '@anthropic-ai/sdk';
import type { INmsConnector } from '@ftth-copilot/connectors-core';
import { SmartOltClient } from '@ftth-copilot/connectors-smartolt';

/**
 * Construye las tools (function calling) que Claude puede invocar.
 * Cada tool envuelve un método del connector.
 */

function asJsonSchema(description: string, properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: 'object' as const,
    description,
    properties,
    required,
  };
}

export function buildTools(connector: INmsConnector): Anthropic.Tool[] {
  return [
    {
      name: 'list_olts',
      description: 'Lista todos los OLTs de la red con su estado, uptime y temperatura.',
      input_schema: asJsonSchema('No requiere parámetros.', {}),
    },
    {
      name: 'get_olt_detail',
      description: 'Obtiene el detalle de un OLT específico por su ID (ej. OLT-001).',
      input_schema: asJsonSchema(
        'Parámetros para obtener el detalle de un OLT.',
        {
          oltId: {
            type: 'string',
            description: 'ID del OLT (ej. OLT-001).',
          },
        },
        ['oltId'],
      ),
    },
    {
      name: 'get_network_overview',
      description:
        'Resumen de toda la red: total de OLTs/ONUs, online/offline, uptime promedio, OLTs con temperatura alta.',
      input_schema: asJsonSchema('No requiere parámetros.', {}),
    },
    {
      name: 'list_onus',
      description:
        'Lista ONUs, opcionalmente filtradas por OLT o estado (online/offline/degraded).',
      input_schema: asJsonSchema(
        'Filtros opcionales para listar ONUs.',
        {
          oltId: {
            type: 'string',
            description: 'Filtrar por OLT específico (opcional).',
          },
          status: {
            type: 'string',
            enum: ['online', 'offline', 'degraded'],
            description: 'Filtrar por estado (opcional).',
          },
        },
      ),
    },
    {
      name: 'get_onu_detail',
      description:
        'Detalle completo de una ONU por su ID (ONU-XXXX) o número de serie (SN-XXXX).',
      input_schema: asJsonSchema(
        'Identificador de la ONU.',
        {
          identifier: {
            type: 'string',
            description: 'ID interno (ej. ONU-0001) o número de serie (ej. SN-A1B2C3D4).',
          },
        },
        ['identifier'],
      ),
    },
    {
      name: 'get_onus_with_low_signal',
      description:
        'Lista ONUs cuya potencia RX está por debajo del umbral indicado (en dBm). Útil para identificar problemas de planta externa.',
      input_schema: asJsonSchema(
        'Umbral en dBm.',
        {
          thresholdDbm: {
            type: 'number',
            description:
              'Umbral de RX power. Sugeridos: -25 (preventivo), -27 (sospechoso), -28 (problema).',
          },
        },
        ['thresholdDbm'],
      ),
    },
    {
      name: 'search_by_customer_name',
      description: 'Busca ONUs por nombre del cliente. Útil cuando el usuario pregunta por un nombre de persona o empresa.',
      input_schema: asJsonSchema(
        'Nombre del cliente a buscar.',
        {
          customerName: {
            type: 'string',
            description: 'Nombre del cliente (búsqueda parcial, no distingue mayúsculas).',
          },
        },
        ['customerName'],
      ),
    },
  ];
}

/**
 * Ejecuta una tool del agente contra el connector subyacente.
 * Devuelve el resultado serializado para reenviarlo a Claude.
 */
export async function executeToolCall(
  connector: INmsConnector,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    let data: unknown;
    switch (toolName) {
      case 'list_olts':
        data = await connector.listOlts();
        break;
      case 'get_olt_detail': {
        const oltId = String(args['oltId']);
        data = await connector.getOltDetail(oltId);
        break;
      }
      case 'get_network_overview':
        data = await connector.getNetworkOverview();
        break;
      case 'list_onus': {
        const oltId = args['oltId'] ? String(args['oltId']) : undefined;
        const status = args['status'] as 'online' | 'offline' | 'degraded' | undefined;
        data = await connector.listOnus(
          oltId || status ? { oltId, status } : undefined,
        );
        break;
      }
      case 'get_onu_detail': {
        const identifier = String(args['identifier']);
        data = await connector.getOnuDetail(identifier);
        break;
      }
      case 'get_onus_with_low_signal': {
        const threshold = Number(args['thresholdDbm']);
        data = await connector.getOnusWithLowSignal(threshold);
        break;
      }
      case 'search_by_customer_name': {
        const name = String(args['customerName']);
        data = await connector.searchByCustomerName(name);
        break;
      }
      default:
        return JSON.stringify({ error: `Tool desconocida: ${toolName}` });
    }
    // Treat explicit null as "not found" so the agent doesn't read it as an error.
    if (data === null || data === undefined) {
      return 'No encontrado en el NMS. Verificá el identificador (ID, SN, o filtro).';
    }
    return JSON.stringify(data, null, 2);
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : 'Error desconocido',
    });
  }
}

/**
 * Construye el connector por defecto (SmartOLT en modo mock).
 * Cuando haya credenciales reales, se reemplaza por SmartOltClient con useMock: false.
 */
export function buildDefaultConnector(): INmsConnector {
  return new SmartOltClient({
    useMock: process.env['SMARTOLT_USE_MOCK'] !== 'false',
    apiKey: process.env['SMARTOLT_API_KEY'],
    apiBaseUrl: process.env['SMARTOLT_API_BASE_URL'],
  });
}
