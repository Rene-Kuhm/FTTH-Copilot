import Anthropic from '@anthropic-ai/sdk';
import type { INmsConnector } from '@ftth-copilot/connectors-core';
import { SmartOltClient } from '@ftth-copilot/connectors-smartolt';
import {
  EVIDENCE_PROVENANCE_SCHEMA,
  evidenceProvenanceSchema,
  type TopologyEdge,
  type TopologyNodeKind,
} from '@ftth-copilot/shared';
import { bfsDownstream, topologyPath } from '@ftth-copilot/evidence';
import {
  PROVENANCE_TOOL_META,
  defaultProvenance,
  deriveSource,
  type ProvenanceContext,
} from './provenance';

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

/** Provides the tenant's proactively-detected (early-warning) issues. */
export type PredictionProvider = () => Promise<unknown>;

/**
 * Fase E — provides the tenant-scoped, `validTo: null`-filtered list of
 * `TopologyEdge` rows for a single tool call. The agent-core stays
 * Prisma-free; the chat route (or test fixtures) own the actual DB read
 * and forward the array via this closure.
 */
export type TopologyProvider = () => Promise<ReadonlyArray<TopologyEdge>>;

export type { ProvenanceContext };

const TOPOLOGY_NODE_KIND_VALUES = ['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU'] as const;

/**
 * Envuelve un payload de tool en el envelope `evidence.provenance.v1`.
 * Se conserva el payload crudo bajo `data` sin truncar ni transformar.
 */
function buildProvenanceEnvelope(
  data: unknown,
  toolName: string,
  provenance?: ProvenanceContext,
): string {
  const meta = PROVENANCE_TOOL_META[toolName] ?? {
    completeness: 'complete' as const,
    confidence: 1.0,
  };
  const mode = provenance?.mode ?? 'live';
  const ttlOverride = meta.ttlOverrideMs;
  const ttlMs = ttlOverride ?? defaultProvenance(mode);
  const source = deriveSource(
    mode,
    provenance?.provider,
    toolName,
    provenance?.source,
  );

  const envelope = {
    schema: EVIDENCE_PROVENANCE_SCHEMA,
    source,
    tenantId: provenance?.tenantId ?? '',
    observedAt: new Date().toISOString(),
    ttlMs,
    completeness: meta.completeness,
    confidence: meta.confidence,
    data,
  };

  const parsed = evidenceProvenanceSchema.safeParse(envelope);
  if (!parsed.success) {
    return JSON.stringify({
      error: `Provenance envelope inválido: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
    });
  }

  return JSON.stringify(parsed.data);
}

export function buildTools(connector: INmsConnector): Anthropic.Tool[] {
  return [
    {
      name: 'get_predicted_issues',
      description:
        'Lista los problemas pronosticados por la detección temprana para este tenant: caída de señal RX, temperatura en ascenso, conexión intermitente, reinicios repetidos y anomalías de métrica, con severidad y ETA estimado.',
      input_schema: asJsonSchema('No requiere parámetros.', {}),
    },
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
    {
      name: 'get_topology_path',
      description:
        'Devuelve la cadena jerárquica completa del dispositivo hasta su OLT raíz (OLT → PON_PORT → SPLITTER → CTO → ONU), en orden hoja-primero. Útil para entender a qué OLT/divisor/CTO pertenece un dispositivo al investigar un incidente.',
      input_schema: asJsonSchema(
        'Identificador del dispositivo a partir del cual subir por la jerarquía.',
        {
          deviceKind: {
            type: 'string',
            enum: [...TOPOLOGY_NODE_KIND_VALUES],
            description: 'Tipo de nodo de topología: OLT | PON_PORT | SPLITTER | CTO | ONU.',
          },
          deviceId: {
            type: 'string',
            description: 'ID del dispositivo (ej. OLT-001, PON-1, SPL-1, CTO-1, ONU-0001).',
          },
        },
        ['deviceKind', 'deviceId'],
      ),
    },
    {
      name: 'get_downstream_clients',
      description:
        'Devuelve todas las ONU IDs aguas abajo del dispositivo indicado (BFS por la jerarquía OLT → PON_PORT → SPLITTER → CTO → ONU). Útil para dimensionar el impacto de un incidente sobre una OLT o CTO.',
      input_schema: asJsonSchema(
        'Identificador del dispositivo raíz del BFS.',
        {
          deviceKind: {
            type: 'string',
            enum: [...TOPOLOGY_NODE_KIND_VALUES],
            description: 'Tipo de nodo de topología: OLT | PON_PORT | SPLITTER | CTO | ONU.',
          },
          deviceId: {
            type: 'string',
            description: 'ID del dispositivo (ej. OLT-001, CTO-1).',
          },
        },
        ['deviceKind', 'deviceId'],
      ),
    },
  ];
}

/**
 * Ejecuta una tool del agente contra el connector subyacente.
 * Devuelve el resultado serializado para reenviarlo a Claude.
 *
 * Fase E — adds a 6th optional `topologyProvider` closure that supplies the
 * tenant-scoped, `validTo: null`-filtered `TopologyEdge[]` consumed by
 * `get_topology_path` + `get_downstream_clients`. The agent-core itself
 * stays Prisma-free; only the caller knows how to read the DB.
 */
export async function executeToolCall(
  connector: INmsConnector,
  toolName: string,
  args: Record<string, unknown>,
  predictionProvider?: PredictionProvider,
  provenance?: ProvenanceContext,
  topologyProvider?: TopologyProvider,
): Promise<string> {
  try {
    let data: unknown;
    // Fase E — topology tools return `null` data when the device has no
    // edges; we still want that wrapped in an `evidence.provenance.v1`
    // envelope so `classifyEnvelope` emits the `incomplete` verdict (per
    // the spec's "Empty graph = incomplete verdict" requirement). All
    // other tools keep the legacy "No encontrado" early-return behavior.
    let skipNullFallback = false;
    switch (toolName) {
      case 'get_predicted_issues':
        if (!predictionProvider) {
          return JSON.stringify({
            error: 'La detección temprana no está disponible en esta sesión.',
          });
        }
        data = await predictionProvider();
        break;
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
      case 'get_topology_path': {
        if (!topologyProvider) {
          return JSON.stringify({
            error: 'La topología no está disponible en esta sesión.',
          });
        }
        const deviceKind = String(args['deviceKind']) as TopologyNodeKind;
        const deviceId = String(args['deviceId']);
        const edges = await topologyProvider();
        // Leaf-first path; empty when the device has no edges → wrap as
        // `null` data (incomplete verdict per spec).
        const path = topologyPath(edges, deviceKind, deviceId);
        data = path.length === 0 ? null : path;
        skipNullFallback = true;
        break;
      }
      case 'get_downstream_clients': {
        if (!topologyProvider) {
          return JSON.stringify({
            error: 'La topología no está disponible en esta sesión.',
          });
        }
        const deviceKind = String(args['deviceKind']) as TopologyNodeKind;
        const deviceId = String(args['deviceId']);
        const edges = await topologyProvider();
        const onuIds = bfsDownstream(edges, deviceKind, deviceId);
        const walkedEdges = countActiveEdges(edges, deviceKind, deviceId);
        data = {
          root: { kind: deviceKind, id: deviceId },
          onuIds,
          edgesTraversed: walkedEdges,
        };
        break;
      }
      default:
        return JSON.stringify({ error: `Tool desconocida: ${toolName}` });
    }
    // Treat explicit null as "not found" so the agent doesn't read it as an error.
    if (!skipNullFallback && (data === null || data === undefined)) {
      return 'No encontrado en el NMS. Verificá el identificador (ID, SN, o filtro).';
    }
    return buildProvenanceEnvelope(data, toolName, provenance);
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : 'Error desconocido',
    });
  }
}

/**
 * Count of `validTo === null` edges the BFS actually walked through to
 * produce the downstream set. Same algorithm as `bfsDownstream` (cycle-safe
 * via node-keyed visited Set) but counting the hops instead of collecting
 * the leaves. For a tree this equals the number of nodes returned plus the
 * intermediate hops; for graphs with merges it counts each unique edge
 * exactly once. Always returns an integer ≥ 0.
 */
function countActiveEdges(
  edges: ReadonlyArray<TopologyEdge>,
  rootKind: TopologyNodeKind,
  rootId: string,
): number {
  const active = edges.filter((e) => e.validTo === null || e.validTo === undefined);
  const visited = new Set<string>([`${rootKind}:${rootId}`]);
  let frontier: Array<{ kind: TopologyNodeKind; id: string }> = [{ kind: rootKind, id: rootId }];
  let traversed = 0;

  while (frontier.length > 0) {
    const next: Array<{ kind: TopologyNodeKind; id: string }> = [];
    for (const node of frontier) {
      for (const edge of active) {
        if (edge.parentKind !== node.kind || edge.parentId !== node.id) continue;
        const childKey = `${edge.childKind}:${edge.childId}`;
        if (visited.has(childKey)) continue;
        visited.add(childKey);
        traversed += 1;
        next.push({ kind: edge.childKind, id: edge.childId });
      }
    }
    frontier = next;
  }
  return traversed;
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
