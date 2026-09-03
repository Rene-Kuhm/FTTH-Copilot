import { DEFAULT_TTL_MS, DEMO_TTL_MS } from '@ftth-copilot/shared';

/**
 * Provenance context threaded from the chat route through `runAgent`
 * to `executeToolCall`. `connectionId` stays in this context for future
 * traceability and never enters the 8-field evidence.provenance.v1 envelope.
 */
export interface ProvenanceContext {
  tenantId?: string;
  connectionId?: string;
  /** Override; wins over automatic derivation. */
  source?: string;
  /** demo -> .demo, live -> .poll */
  mode?: 'live' | 'demo';
  /** Lowercased -> providerName. */
  provider?: string;
}

export type ProvenanceCompleteness = 'complete' | 'partial' | 'minimal';

export interface ProvenanceToolMeta {
  completeness: ProvenanceCompleteness;
  confidence: number;
  ttlOverrideMs?: number;
}

/**
 * Derives the `source` field for an evidence.provenance.v1 envelope.
 * `get_predicted_issues` always resolves to `curated`; all other tools use
 * `(override ?? provider.toLowerCase()) + (mode === 'demo' ? '.demo' : '.poll')`.
 */
export function deriveSource(
  mode: 'live' | 'demo' | undefined,
  provider: string | undefined,
  toolName: string,
  sourceOverride?: string,
): string {
  if (toolName === 'get_predicted_issues') return 'curated';
  if (sourceOverride) return sourceOverride;
  const providerName = (provider ?? '').toLowerCase();
  const suffix = mode === 'demo' ? '.demo' : '.poll';
  return `${providerName}${suffix}`;
}

/**
 * Returns the TTL for an evidence envelope: `DEMO_TTL_MS` in demo mode,
 * `DEFAULT_TTL_MS` otherwise.
 */
export function defaultProvenance(mode: 'live' | 'demo' | undefined): number {
  return mode === 'demo' ? DEMO_TTL_MS : DEFAULT_TTL_MS;
}

/**
 * Per-tool completeness / confidence / TTL override metadata. `get_predicted_issues`
 * carries minimal completeness and low confidence with its own short TTL; detail and
 * search tools are partial; everything else is complete.
 *
 * Fase E — topology tools (`get_topology_path`, `get_downstream_clients`)
 * are registered as `partial / 0.9`: the topology graph can be stale
 * (operators edit edges out of band, soft-expiry via `validTo`) so we
 * never claim `complete`. Same envelope shape (8-field
 * `evidence.provenance.v1`) — only the meta flips.
 */
export const PROVENANCE_TOOL_META: Record<string, ProvenanceToolMeta> = {
  get_predicted_issues: { completeness: 'minimal', confidence: 0.5, ttlOverrideMs: 60000 },
  list_olts: { completeness: 'complete', confidence: 1.0 },
  get_olt_detail: { completeness: 'complete', confidence: 1.0 },
  get_network_overview: { completeness: 'complete', confidence: 1.0 },
  list_onus: { completeness: 'complete', confidence: 1.0 },
  get_onu_detail: { completeness: 'partial', confidence: 0.8 },
  get_onus_with_low_signal: { completeness: 'partial', confidence: 0.8 },
  search_by_customer_name: { completeness: 'partial', confidence: 0.8 },
  get_topology_path: { completeness: 'partial', confidence: 0.9 },
  get_downstream_clients: { completeness: 'partial', confidence: 0.9 },
};
