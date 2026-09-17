import { prisma } from '@ftth-copilot/db';
import { snapshotHealth, type SchedulerName } from '@/lib/monitoring/scheduler-health';

interface MetricsState {
  snmpTrapsReceived: number;
  snmpTrapsDeduped: number;
  snmpTrapsDropped: number;
  llmRequestsTotal: Map<string, number>;
  llmLatencySumMs: Map<string, number>;
  llmLatencyCount: Map<string, number>;
  llmTokensTotal: Map<string, number>;
  llmFallbackEventsTotal: Map<string, number>;
  ragRetrievalsTotal: Map<string, number>;
  ragLatencySumMs: number;
  ragLatencyCount: number;
  routerDispatchesTotal: Map<string, number>;
}

const state: MetricsState = {
  snmpTrapsReceived: 0,
  snmpTrapsDeduped: 0,
  snmpTrapsDropped: 0,
  llmRequestsTotal: new Map(),
  llmLatencySumMs: new Map(),
  llmLatencyCount: new Map(),
  llmTokensTotal: new Map(),
  llmFallbackEventsTotal: new Map(),
  ragRetrievalsTotal: new Map(),
  ragLatencySumMs: 0,
  ragLatencyCount: 0,
  routerDispatchesTotal: new Map(),
};

/**
 * Record an incoming or processed SNMP trap event.
 */
export function recordSnmpTrapMetrics(type: 'received' | 'deduped' | 'dropped'): void {
  if (type === 'received') state.snmpTrapsReceived++;
  else if (type === 'deduped') state.snmpTrapsDeduped++;
  else if (type === 'dropped') state.snmpTrapsDropped++;
}

/**
 * Record an LLM inference request duration and status.
 */
export function recordLlmMetrics(provider: string, status: 'ok' | 'error', durationMs: number): void {
  const sanitizedProvider = escapeLabel(provider || 'unknown');
  const reqKey = `provider="${sanitizedProvider}",status="${status}"`;
  state.llmRequestsTotal.set(reqKey, (state.llmRequestsTotal.get(reqKey) ?? 0) + 1);

  const latKey = `provider="${sanitizedProvider}"`;
  state.llmLatencySumMs.set(latKey, (state.llmLatencySumMs.get(latKey) ?? 0) + durationMs);
  state.llmLatencyCount.set(latKey, (state.llmLatencyCount.get(latKey) ?? 0) + 1);
}

/**
 * Record token consumption for an LLM provider.
 */
export function recordLlmTokens(provider: string, type: 'prompt' | 'completion', count: number): void {
  const sanitizedProvider = escapeLabel(provider || 'unknown');
  const key = `provider="${sanitizedProvider}",type="${type}"`;
  state.llmTokensTotal.set(key, (state.llmTokensTotal.get(key) ?? 0) + count);
}

/**
 * Record a fallback event when an LLM provider fails and the next is selected.
 */
export function recordLlmFallback(primary: string, fallback: string): void {
  const key = `primary="${escapeLabel(primary)}",fallback="${escapeLabel(fallback)}"`;
  state.llmFallbackEventsTotal.set(key, (state.llmFallbackEventsTotal.get(key) ?? 0) + 1);
}

/**
 * Record RAG context retrieval status and duration.
 */
export function recordRagMetrics(status: 'ok' | 'empty' | 'error', durationMs: number): void {
  const key = `status="${status}"`;
  state.ragRetrievalsTotal.set(key, (state.ragRetrievalsTotal.get(key) ?? 0) + 1);
  state.ragLatencySumMs += durationMs;
  state.ragLatencyCount++;
}

/**
 * Adaptive Router (Slice 3) — record a router dispatch decision. Emits
 * `ftth_copilot_router_dispatches_total{mode="..."}` so the chat route's
 * before/after measurement (Block 1's instrumentation) is consumable.
 */
export function recordRouterDispatch(mode: 'direct' | 'assisted' | 'investigation' | 'unknown'): void {
  const sanitized = mode.replace(/[^a-z]/g, 'unknown');
  const key = `mode="${sanitized}"`;
  state.routerDispatchesTotal.set(key, (state.routerDispatchesTotal.get(key) ?? 0) + 1);
}

/**
 * Reset in-memory metrics (primarily used for unit testing).
 */
export function __resetMetricsState(): void {
  state.snmpTrapsReceived = 0;
  state.snmpTrapsDeduped = 0;
  state.snmpTrapsDropped = 0;
  state.llmRequestsTotal.clear();
  state.llmLatencySumMs.clear();
  state.llmLatencyCount.clear();
  state.llmTokensTotal.clear();
  state.llmFallbackEventsTotal.clear();
  state.ragRetrievalsTotal.clear();
  state.ragLatencySumMs = 0;
  state.ragLatencyCount = 0;
  state.routerDispatchesTotal.clear();
}

function escapeLabel(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Formats all application, database, and process metrics into standard Prometheus exposition format.
 */
export async function generatePrometheusMetrics(): Promise<string> {
  const lines: string[] = [];

  // 1. Process & Runtime metrics
  lines.push('# HELP ftth_copilot_process_uptime_seconds Process uptime in seconds.');
  lines.push('# TYPE ftth_copilot_process_uptime_seconds gauge');
  lines.push(`ftth_copilot_process_uptime_seconds ${process.uptime().toFixed(3)}`);
  lines.push('');

  const mem = process.memoryUsage();
  lines.push('# HELP ftth_copilot_process_memory_bytes Process memory usage in bytes.');
  lines.push('# TYPE ftth_copilot_process_memory_bytes gauge');
  lines.push(`ftth_copilot_process_memory_bytes{type="rss"} ${mem.rss}`);
  lines.push(`ftth_copilot_process_memory_bytes{type="heap_used"} ${mem.heapUsed}`);
  lines.push(`ftth_copilot_process_memory_bytes{type="heap_total"} ${mem.heapTotal}`);
  lines.push(`ftth_copilot_process_memory_bytes{type="external"} ${mem.external}`);
  lines.push('');

  // 2. Scheduled service loops health
  const services = snapshotHealth();
  lines.push('# HELP ftth_copilot_service_loop_healthy Status of background scheduled loops (1=healthy/active, 0=degraded/stopped).');
  lines.push('# TYPE ftth_copilot_service_loop_healthy gauge');

  for (const [name, s] of Object.entries(services) as [SchedulerName, typeof services[SchedulerName]][]) {
    const isHealthy = s.expected ? (s.lastError === null ? 1 : 0) : 0;
    lines.push(`ftth_copilot_service_loop_healthy{service="${name}",expected="${s.expected}"} ${isHealthy}`);
  }
  lines.push('');

  // 3. SNMP Traps In-Memory Counters
  lines.push('# HELP ftth_copilot_snmp_traps_total Cumulative SNMP traps received, deduped or dropped.');
  lines.push('# TYPE ftth_copilot_snmp_traps_total counter');
  lines.push(`ftth_copilot_snmp_traps_total{status="received"} ${state.snmpTrapsReceived}`);
  lines.push(`ftth_copilot_snmp_traps_total{status="deduped"} ${state.snmpTrapsDeduped}`);
  lines.push(`ftth_copilot_snmp_traps_total{status="dropped"} ${state.snmpTrapsDropped}`);
  lines.push('');

  // 4. LLM Request & Latency Counters
  lines.push('# HELP ftth_copilot_llm_requests_total Total LLM conversational completions requested.');
  lines.push('# TYPE ftth_copilot_llm_requests_total counter');
  if (state.llmRequestsTotal.size === 0) {
    lines.push('ftth_copilot_llm_requests_total{provider="none",status="ok"} 0');
  } else {
    for (const [labels, count] of state.llmRequestsTotal.entries()) {
      lines.push(`ftth_copilot_llm_requests_total{${labels}} ${count}`);
    }
  }
  lines.push('');

  lines.push('# HELP ftth_copilot_llm_latency_seconds_total Total duration of LLM calls in seconds.');
  lines.push('# TYPE ftth_copilot_llm_latency_seconds_total counter');
  lines.push('# HELP ftth_copilot_llm_latency_seconds_count Count of LLM calls with measured latency.');
  lines.push('# TYPE ftth_copilot_llm_latency_seconds_count counter');
  if (state.llmLatencySumMs.size === 0) {
    lines.push('ftth_copilot_llm_latency_seconds_total{provider="none"} 0');
    lines.push('ftth_copilot_llm_latency_seconds_count{provider="none"} 0');
  } else {
    for (const [labels, sumMs] of state.llmLatencySumMs.entries()) {
      const count = state.llmLatencyCount.get(labels) ?? 0;
      lines.push(`ftth_copilot_llm_latency_seconds_total{${labels}} ${(sumMs / 1000).toFixed(4)}`);
      lines.push(`ftth_copilot_llm_latency_seconds_count{${labels}} ${count}`);
    }
  }
  lines.push('');

  // 5. LLM Tokens & Fallback Counters
  lines.push('# HELP ftth_copilot_llm_tokens_total Total tokens consumed in LLM inference requests.');
  lines.push('# TYPE ftth_copilot_llm_tokens_total counter');
  if (state.llmTokensTotal.size === 0) {
    lines.push('ftth_copilot_llm_tokens_total{provider="none",type="total"} 0');
  } else {
    for (const [labels, count] of state.llmTokensTotal.entries()) {
      lines.push(`ftth_copilot_llm_tokens_total{${labels}} ${count}`);
    }
  }
  lines.push('');

  lines.push('# HELP ftth_copilot_llm_fallback_events_total Total LLM provider fallback occurrences.');
  lines.push('# TYPE ftth_copilot_llm_fallback_events_total counter');
  if (state.llmFallbackEventsTotal.size === 0) {
    lines.push('ftth_copilot_llm_fallback_events_total{primary="none",fallback="none"} 0');
  } else {
    for (const [labels, count] of state.llmFallbackEventsTotal.entries()) {
      lines.push(`ftth_copilot_llm_fallback_events_total{${labels}} ${count}`);
    }
  }
  lines.push('');

  // 6. RAG Retrieval Metrics
  lines.push('# HELP ftth_copilot_rag_retrievals_total Total RAG incident retrievals.');
  lines.push('# TYPE ftth_copilot_rag_retrievals_total counter');
  if (state.ragRetrievalsTotal.size === 0) {
    lines.push('ftth_copilot_rag_retrievals_total{status="ok"} 0');
  } else {
    for (const [labels, count] of state.ragRetrievalsTotal.entries()) {
      lines.push(`ftth_copilot_rag_retrievals_total{${labels}} ${count}`);
    }
  }
  lines.push('');

  lines.push('# HELP ftth_copilot_rag_latency_seconds_total Total duration of RAG incident retrievals in seconds.');
  lines.push('# TYPE ftth_copilot_rag_latency_seconds_total counter');
  lines.push('# HELP ftth_copilot_rag_latency_seconds_count Count of RAG incident retrievals.');
  lines.push('# TYPE ftth_copilot_rag_latency_seconds_count counter');
  lines.push(`ftth_copilot_rag_latency_seconds_total ${(state.ragLatencySumMs / 1000).toFixed(4)}`);
  lines.push(`ftth_copilot_rag_latency_seconds_count ${state.ragLatencyCount}`);

      // 6.5 Adaptive Router Dispatches (Slice 3 — adaptive-router change).
      // Records how the runtime decided to handle each request:
      // direct (no LLM), assisted (1 LLM call), or investigation (full loop).
      lines.push('# HELP ftth_copilot_router_dispatches_total Total agent runs by adaptive-router mode.');
      lines.push('# TYPE ftth_copilot_router_dispatches_total counter');
      if (state.routerDispatchesTotal.size === 0) {
        lines.push('ftth_copilot_router_dispatches_total{mode="unknown"} 0');
      } else {
        for (const [labels, count] of state.routerDispatchesTotal.entries()) {
          lines.push(`ftth_copilot_router_dispatches_total{${labels}} ${count}`);
        }
      }
  lines.push('');

  // 7. Database Operational Metrics
  try {
    const [alertGroups, activeIncidents, totalSamples, totalTenants, connections] = await Promise.all([
      prisma.detectedAlert.groupBy({
        by: ['severity', 'status'],
        _count: { _all: true },
      }),
      prisma.incident.count({
        where: { status: 'open' },
      }),
      prisma.metricSample.count(),
      prisma.tenant.count(),
      prisma.nmsConnection.groupBy({
        by: ['provider'],
        _count: { _all: true },
      }),
    ]);

    lines.push('# HELP ftth_copilot_active_alerts Current alerts in database by severity and status.');
    lines.push('# TYPE ftth_copilot_active_alerts gauge');
    if (alertGroups.length === 0) {
      lines.push('ftth_copilot_active_alerts{severity="warning",status="open"} 0');
      lines.push('ftth_copilot_active_alerts{severity="critical",status="open"} 0');
    } else {
      for (const group of alertGroups) {
        lines.push(`ftth_copilot_active_alerts{severity="${group.severity}",status="${group.status}"} ${group._count._all}`);
      }
    }
    lines.push('');

    lines.push('# HELP ftth_copilot_active_incidents Current open incidents.');
    lines.push('# TYPE ftth_copilot_active_incidents gauge');
    lines.push(`ftth_copilot_active_incidents ${activeIncidents}`);
    lines.push('');

    lines.push('# HELP ftth_copilot_metric_samples_total Total optical metric samples stored.');
    lines.push('# TYPE ftth_copilot_metric_samples_total gauge');
    lines.push(`ftth_copilot_metric_samples_total ${totalSamples}`);
    lines.push('');

    lines.push('# HELP ftth_copilot_tenants_total Total registered tenants.');
    lines.push('# TYPE ftth_copilot_tenants_total gauge');
    lines.push(`ftth_copilot_tenants_total ${totalTenants}`);
    lines.push('');

    lines.push('# HELP ftth_copilot_nms_connections_total NMS connections configured by provider.');
    lines.push('# TYPE ftth_copilot_nms_connections_total gauge');
    if (connections.length === 0) {
      lines.push('ftth_copilot_nms_connections_total{provider="none"} 0');
    } else {
      for (const c of connections) {
        lines.push(`ftth_copilot_nms_connections_total{provider="${c.provider.toLowerCase()}"} ${c._count._all}`);
      }
    }
    lines.push('');
  } catch (err) {
    // If DB is unreachable, surface DB error metric without crashing Prometheus scraper
    lines.push('# HELP ftth_copilot_database_scrape_error Database connection error indicator during scrape.');
    lines.push('# TYPE ftth_copilot_database_scrape_error gauge');
    lines.push(`ftth_copilot_database_scrape_error 1`);
    lines.push('');
  }

  return lines.join('\n') + '\n';
}
