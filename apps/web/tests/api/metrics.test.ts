import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  __resetMetricsState,
  recordLlmMetrics,
  recordLlmTokens,
  recordLlmFallback,
  recordRagMetrics,
  recordSnmpTrapMetrics,
} from '@/lib/metrics/prometheus';
import {
  __resetSchedulerHealth,
  markExpected,
  recordSuccess,
} from '@/lib/monitoring/scheduler-health';
import { GET } from '@/app/api/metrics/route';

const mockGroupByAlerts = vi.fn();
const mockCountIncidents = vi.fn();
const mockCountSamples = vi.fn();
const mockCountTenants = vi.fn();
const mockGroupByConnections = vi.fn();

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    detectedAlert: {
      groupBy: (...args: unknown[]) => mockGroupByAlerts(...args),
    },
    incident: {
      count: (...args: unknown[]) => mockCountIncidents(...args),
    },
    metricSample: {
      count: (...args: unknown[]) => mockCountSamples(...args),
    },
    tenant: {
      count: (...args: unknown[]) => mockCountTenants(...args),
    },
    nmsConnection: {
      groupBy: (...args: unknown[]) => mockGroupByConnections(...args),
    },
  },
}));

beforeEach(() => {
  __resetMetricsState();
  __resetSchedulerHealth();
  delete process.env.METRICS_BEARER_TOKEN;

  mockGroupByAlerts.mockReset().mockResolvedValue([
    { severity: 'warning', status: 'open', _count: { _all: 3 } },
    { severity: 'critical', status: 'open', _count: { _all: 1 } },
  ]);
  mockCountIncidents.mockReset().mockResolvedValue(2);
  mockCountSamples.mockReset().mockResolvedValue(15420);
  mockCountTenants.mockReset().mockResolvedValue(5);
  mockGroupByConnections.mockReset().mockResolvedValue([
    { provider: 'SMARTOLT', _count: { _all: 4 } },
    { provider: 'MIKROWISP', _count: { _all: 2 } },
  ]);
});

afterEach(() => {
  __resetMetricsState();
  __resetSchedulerHealth();
  delete process.env.METRICS_BEARER_TOKEN;
});

describe('GET /api/metrics', () => {
  it('returns 200 with Prometheus text/plain content type', async () => {
    const req = new NextRequest('http://localhost:3001/api/metrics');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('content-type')).toContain('version=0.0.4');

    const body = await res.text();
    expect(body).toContain('# HELP ftth_copilot_process_uptime_seconds');
    expect(body).toContain('ftth_copilot_process_uptime_seconds');
    expect(body).toContain('ftth_copilot_process_memory_bytes{type="rss"}');
    expect(body).toContain('ftth_copilot_active_alerts{severity="warning",status="open"} 3');
    expect(body).toContain('ftth_copilot_active_alerts{severity="critical",status="open"} 1');
    expect(body).toContain('ftth_copilot_active_incidents 2');
    expect(body).toContain('ftth_copilot_metric_samples_total 15420');
    expect(body).toContain('ftth_copilot_tenants_total 5');
    expect(body).toContain('ftth_copilot_nms_connections_total{provider="smartolt"} 4');
  });

  it('reflects in-memory counters for SNMP and LLM calls', async () => {
    recordSnmpTrapMetrics('received');
    recordSnmpTrapMetrics('received');
    recordSnmpTrapMetrics('deduped');
    recordLlmMetrics('minimax', 'ok', 350);
    recordLlmMetrics('deepseek', 'error', 1200);

    const req = new NextRequest('http://localhost:3001/api/metrics');
    const res = await GET(req);
    const body = await res.text();

    expect(body).toContain('ftth_copilot_snmp_traps_total{status="received"} 2');
    expect(body).toContain('ftth_copilot_snmp_traps_total{status="deduped"} 1');
    expect(body).toContain('ftth_copilot_snmp_traps_total{status="dropped"} 0');
    expect(body).toContain('ftth_copilot_llm_requests_total{provider="minimax",status="ok"} 1');
    expect(body).toContain('ftth_copilot_llm_requests_total{provider="deepseek",status="error"} 1');
    expect(body).toContain('ftth_copilot_llm_latency_seconds_count{provider="minimax"} 1');
  });

  it('reflects LLM tokens, provider fallback, and RAG retrieval metrics', async () => {
    recordLlmTokens('minimax', 'prompt', 1500);
    recordLlmTokens('minimax', 'completion', 240);
    recordLlmFallback('minimax', 'deepseek');
    recordRagMetrics('ok', 45);

    const req = new NextRequest('http://localhost:3001/api/metrics');
    const res = await GET(req);
    const body = await res.text();

    expect(body).toContain('ftth_copilot_llm_tokens_total{provider="minimax",type="prompt"} 1500');
    expect(body).toContain('ftth_copilot_llm_tokens_total{provider="minimax",type="completion"} 240');
    expect(body).toContain('ftth_copilot_llm_fallback_events_total{primary="minimax",fallback="deepseek"} 1');
    expect(body).toContain('ftth_copilot_rag_retrievals_total{status="ok"} 1');
    expect(body).toContain('ftth_copilot_rag_latency_seconds_count 1');
  });

  it('reflects background scheduler service loops', async () => {
    markExpected('polling');
    recordSuccess('polling', Date.now());

    const req = new NextRequest('http://localhost:3001/api/metrics');
    const res = await GET(req);
    const body = await res.text();

    expect(body).toContain('ftth_copilot_service_loop_healthy{service="polling",expected="true"} 1');
  });

  it('enforces bearer authentication when METRICS_BEARER_TOKEN is configured', async () => {
    process.env.METRICS_BEARER_TOKEN = 'secret-token-12345';

    // 1. Missing header
    const reqNoAuth = new NextRequest('http://localhost:3001/api/metrics');
    const resNoAuth = await GET(reqNoAuth);
    expect(resNoAuth.status).toBe(401);

    // 2. Invalid token
    const reqBadAuth = new NextRequest('http://localhost:3001/api/metrics', {
      headers: { authorization: 'Bearer wrong-token' },
    });
    const resBadAuth = await GET(reqBadAuth);
    expect(resBadAuth.status).toBe(401);

    // 3. Valid token
    const reqGoodAuth = new NextRequest('http://localhost:3001/api/metrics', {
      headers: { authorization: 'Bearer secret-token-12345' },
    });
    const resGoodAuth = await GET(reqGoodAuth);
    expect(resGoodAuth.status).toBe(200);
  });

  it('surfaces scrape error indicator if database query fails', async () => {
    mockGroupByAlerts.mockRejectedValueOnce(new Error('Connection lost'));

    const req = new NextRequest('http://localhost:3001/api/metrics');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).toContain('ftth_copilot_database_scrape_error 1');
  });
});
