import type { Page } from '@playwright/test';

/**
 * Fixed instant used across accessibility and visual E2E tests so relative
 * timestamps, uptime readouts, and charts stay deterministic.
 */
const TEST_NOW_ISO = '2026-01-15T12:00:00.000Z';

/**
 * Invented tenant used exclusively for synthetic E2E fixtures.
 */
const SYNTHETIC_TENANT: { id: string; name: string } = {
  id: 'tenant-demo-0001',
  name: 'Fibra Demo Sur',
};

const SYNTHETIC_USER = {
  id: 'user-demo-0001',
  email: 'noc.demo@example.com',
  name: 'NOC Demo Operator',
  role: 'OWNER' as const,
  tenantId: SYNTHETIC_TENANT.id,
  mfaEnabled: false,
  tenant: {
    id: SYNTHETIC_TENANT.id,
    name: SYNTHETIC_TENANT.name,
    slug: 'fibra-demo-sur',
  },
};

const SYNTHETIC_DATA_SOURCE = {
  mode: 'demo' as const,
  provider: 'SMARTOLT',
  label: 'SmartOLT Demo Norte',
};

function syntheticAuthMePayload() {
  return {
    user: SYNTHETIC_USER,
  };
}

function syntheticConnectorsPayload() {
  return {
    user: {
      id: SYNTHETIC_USER.id,
      email: SYNTHETIC_USER.email,
      tenant: SYNTHETIC_USER.tenant,
    },
    connectors: [
      {
        id: 'conn-demo-0001',
        provider: 'SMARTOLT',
        label: 'SmartOLT Demo Norte',
        baseUrl: 'https://192.0.2.10',
        status: 'connected',
        lastCheckedAt: TEST_NOW_ISO,
        lastError: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    demoMode: false,
  };
}

function syntheticDashboardPayload() {
  return {
    dataSource: SYNTHETIC_DATA_SOURCE,
    overview: {
      totalOlts: 2,
      oltsOnline: 2,
      totalOnus: 128,
      onusOnline: 121,
      onusOffline: 4,
      averageUptimeSeconds: 1_209_600,
      oltsWithHighTemperature: 0,
    },
    olts: [
      {
        id: 'olt-demo-01',
        name: 'OLT Cabecera Norte',
        ip: '192.0.2.11',
        status: 'online',
        temperatureCelsius: 41,
        uptimeSeconds: 1_296_000,
        vendor: 'Huawei',
        onusTotal: 64,
        onusOnline: 61,
        onusOffline: 2,
        onusDegraded: 1,
      },
      {
        id: 'olt-demo-02',
        name: 'OLT Nodo Sur',
        ip: '198.51.100.12',
        status: 'online',
        temperatureCelsius: 44,
        uptimeSeconds: 1_123_200,
        vendor: 'ZTE',
        onusTotal: 64,
        onusOnline: 60,
        onusOffline: 2,
        onusDegraded: 2,
      },
    ],
    statusDistribution: {
      online: 121,
      offline: 4,
      degraded: 3,
    },
  };
}

function syntheticIncidentsPayload() {
  return {
    incidents: [
      {
        id: 'inc-demo-0001',
        deviceKind: 'OLT',
        deviceId: 'olt-demo-01',
        title: 'Atenuación óptica en puerto PON 0/1/3',
        description: 'Caída de nivel RX promedio por debajo de -26 dBm en rama norte.',
        severity: 'critical',
        status: 'open',
        firstSeenAt: '2026-01-15T11:15:00.000Z',
        lastSeenAt: TEST_NOW_ISO,
        alertCount: 3,
      },
      {
        id: 'inc-demo-0002',
        deviceKind: 'ONU',
        deviceId: 'onu-demo-042',
        title: 'Pérdida intermitente de señal en ONU-042',
        description: 'Tres desconexiones breves registradas en los últimos 30 minutos.',
        severity: 'warning',
        status: 'acknowledged',
        firstSeenAt: '2026-01-15T10:30:00.000Z',
        lastSeenAt: '2026-01-15T11:45:00.000Z',
        alertCount: 1,
      },
    ],
    count: 2,
    page: {
      scope: 'unresolved',
      hasMore: false,
      nextCursor: null,
      total: 2,
    },
  };
}

function syntheticPredictionsPayload() {
  return {
    predictions: [
      {
        id: 'pred-demo-0001',
        kind: 'predicted_low_signal',
        severity: 'warning',
        deviceKind: 'ONU',
        deviceId: 'onu-demo-018',
        title: 'Degradación gradual de RX en ONU-018',
        description: 'Tendencia descendente de -0.4 dB/h detectada en enlace troncal.',
        etaMs: 14_400_000,
        confidence: 0.87,
        status: 'open',
        firstSeenAt: '2026-01-15T09:00:00.000Z',
        lastSeenAt: TEST_NOW_ISO,
      },
    ],
    count: 1,
    page: {
      scope: 'unresolved',
      hasMore: false,
      nextCursor: null,
      total: 1,
    },
  };
}

function syntheticSlaPayload() {
  return {
    windowDays: 30,
    sla: [
      {
        connectionId: 'conn-demo-0001',
        deviceKind: 'OLT',
        deviceId: 'olt-demo-01',
        uptimePercent: 99.94,
        coveragePercent: 100,
        measuredMs: 2_592_000_000,
        unmeasuredMs: 0,
        offlineMs: 1_555_200,
      },
      {
        connectionId: 'conn-demo-0001',
        deviceKind: 'OLT',
        deviceId: 'olt-demo-02',
        uptimePercent: 99.82,
        coveragePercent: 100,
        measuredMs: 2_592_000_000,
        unmeasuredMs: 0,
        offlineMs: 4_665_600,
      },
    ],
    count: 2,
  };
}

function syntheticAccessEventsPayload() {
  return {
    events: [
      {
        id: 'evt-demo-0001',
        sourceIp: '203.0.113.25',
        category: 'access',
        message: 'SSH session opened on OLT Cabecera Norte by noc.demo',
        occurredAt: '2026-01-15T11:50:00.000Z',
      },
      {
        id: 'evt-demo-0002',
        sourceIp: '198.51.100.77',
        category: 'auth_failure',
        message: 'Failed RADIUS authentication attempt on OLT Nodo Sur',
        occurredAt: '2026-01-15T11:40:00.000Z',
      },
    ],
    count: 2,
  };
}

function syntheticAlertsPayload() {
  return {
    alerts: [
      {
        id: 'alert-demo-0001',
        severity: 'critical',
        category: 'optical_power',
        title: 'Potencia RX crítica en PON 0/1/3',
        description: '3 ONUs reportan RX inferior a -28 dBm.',
        affectedEntity: 'olt-demo-01',
        detectedAt: '2026-01-15T11:55:00.000Z',
      },
      {
        id: 'alert-demo-0002',
        severity: 'warning',
        category: 'temperature',
        title: 'Temperatura elevada en chasis OLT Nodo Sur',
        description: 'Sensor principal en 44 °C (umbral preventivo 45 °C).',
        affectedEntity: 'olt-demo-02',
        detectedAt: '2026-01-15T11:30:00.000Z',
      },
    ],
    count: 2,
    dataSource: SYNTHETIC_DATA_SOURCE,
  };
}

function syntheticMetricsText(): string {
  return [
    '# HELP ftth_copilot_process_uptime_seconds Process uptime in seconds.',
    '# TYPE ftth_copilot_process_uptime_seconds gauge',
    'ftth_copilot_process_uptime_seconds 86400.000',
    '',
    '# HELP ftth_copilot_active_incidents Current open incidents.',
    '# TYPE ftth_copilot_active_incidents gauge',
    'ftth_copilot_active_incidents 2',
    '',
    '# HELP ftth_laya_requests_total Total Laya decision requests by mode, event class and result.',
    '# TYPE ftth_laya_requests_total counter',
    'ftth_laya_requests_total{mode="shadow",event_class="OPTICAL_FAULT",result="classified"} 14',
    'ftth_laya_requests_total{mode="shadow",event_class="CONGESTION",result="classified"} 6',
    '',
    '# HELP ftth_laya_latency_ms Laya decision latency percentiles in milliseconds.',
    '# TYPE ftth_laya_latency_ms gauge',
    'ftth_laya_latency_ms{mode="shadow",quantile="p50"} 1.15',
    'ftth_laya_latency_ms{mode="shadow",quantile="p95"} 2.80',
    'ftth_laya_latency_ms{mode="shadow",quantile="p99"} 4.10',
    '',
    '# HELP ftth_laya_confidence Laya decision confidence statistics by event class.',
    '# TYPE ftth_laya_confidence gauge',
    'ftth_laya_confidence{event_class="OPTICAL_FAULT",stat="avg"} 0.920',
    'ftth_laya_confidence{event_class="OPTICAL_FAULT",stat="min"} 0.840',
    'ftth_laya_confidence{event_class="OPTICAL_FAULT",stat="max"} 0.980',
    '',
  ].join('\n');
}

const VM_INSTANT: Record<string, string> = {
  'up{job="ftth-copilot-app"}': '1',
  'sum(ftth_ops_active:alerts{severity="critical"})': '1',
  'sum(ftth_ops_active:alerts{severity="warning"})': '1',
  'sum(ftth_ops_active:incidents)': '2',
  'ftth_copilot_process_uptime_seconds': '86400',
  'ftth_copilot_metric_samples_total': '384',
  'sum(increase(ftth_copilot_llm_requests_total[15m]))': '8',
};

const VM_SERIES: Record<string, { labels: Record<string, string>; values: string[] }> = {
  'ftth_llm_latency_seconds:avg15m': { labels: { provider: 'sintetico' }, values: ['0.7', '0.9', '0.8'] },
  'sum(increase(ftth_copilot_llm_requests_total[15m]))': { labels: {}, values: ['4', '6', '8'] },
};

function metricsPayload(url: URL) {
  const query = url.searchParams.get('query') ?? '';
  const now = Date.parse(TEST_NOW_ISO) / 1000;
  const instant = VM_INSTANT[query];
  const series = VM_SERIES[query];
  const result = url.pathname === '/api/vm/instant'
    ? (instant === undefined ? [] : [{ metric: {}, values: [[now, instant]] }])
    : (series ? [{
        metric: series.labels,
        values: series.values.map((value, index) => [now - 120 + index * 60, value]),
      }] : []);
  return { status: 'success', data: { resultType: 'matrix', result } };
}

const tenantReads: Record<string, (url: URL) => object> = {
  '/api/dashboard': syntheticDashboardPayload,
  '/api/incidents': (url) => url.searchParams.get('status') === 'resolved'
    ? { incidents: [], count: 0, page: { scope: 'resolved', hasMore: false, nextCursor: null, total: 0 } }
    : syntheticIncidentsPayload(),
  '/api/predictions': syntheticPredictionsPayload,
  '/api/sla': syntheticSlaPayload,
  '/api/security/access': syntheticAccessEventsPayload,
  '/api/alerts': syntheticAlertsPayload,
  '/api/conversations': () => ({
    conversations: [
      { id: 'conv-demo-0001', title: 'Estado PON 0/1/3 Norte', updatedAt: TEST_NOW_ISO, messageCount: 2 },
    ],
  }),
  '/api/users': () => ({
    users: [
      { ...SYNTHETIC_USER, createdAt: TEST_NOW_ISO },
      {
        id: 'user-demo-0002',
        email: 'operador.demo@example.com',
        name: 'Operador Guardia',
        role: 'OPERATOR',
        tenantId: SYNTHETIC_TENANT.id,
        createdAt: TEST_NOW_ISO,
      },
    ],
  }),
  '/api/fiber-plans': () => ({ plans: [] }),
  '/api/fiber-plans/correlate': () => ({ plans: [] }),
  '/api/topology/downstream': (url) => ({
    schema: 'ftth.topology.v1',
    kind: url.searchParams.get('kind'),
    id: url.searchParams.get('id'),
    onuIds: ['onu-demo-001', 'onu-demo-002'],
    edgesTraversed: 2,
  }),
  '/api/topology/tree': () => ({
    roots: [{
      kind: 'OLT',
      id: 'olt-demo-01',
      downstreamCount: 2,
      children: [{
        kind: 'PON_PORT',
        id: 'pon-0-1-3',
        downstreamCount: 2,
        children: [
          { kind: 'ONU', id: 'onu-demo-001', downstreamCount: 0, children: [] },
          { kind: 'ONU', id: 'onu-demo-002', downstreamCount: 0, children: [] },
        ],
      }],
    }],
    nodeCount: 4,
    count: 1,
  }),
  '/api/vm/query': metricsPayload,
  '/api/vm/instant': metricsPayload,
};

export async function mockAppApis(page: Page, origin: string, signedIn: boolean) {
  await page.context().route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    // FeedbackControls initializes an investigation for each displayed incident.
    // Fulfill it locally so the dashboard can render actionable feedback controls.
    const incident = url.pathname.match(/^\/api\/incidents\/(inc-demo-000[12])\/investigate$/);
    if (signedIn && incident && request.method() === 'POST') {
      return route.fulfill({
        json: { runId: `run-${incident[1]}`, versionId: `version-${incident[1]}`, status: 'completed', idempotent: true },
      });
    }
    if (request.method() !== 'GET') return route.fulfill({ status: 405 });

    if (url.pathname === '/api/auth/me') {
      return route.fulfill({ json: signedIn ? syntheticAuthMePayload() : { user: null } });
    }
    if (!signedIn) return route.fulfill({ status: 401 });
    if (url.pathname === '/api/connectors') {
      return route.fulfill({ json: syntheticConnectorsPayload() });
    }
    if (url.pathname === '/api/metrics') {
      return route.fulfill({ contentType: 'text/plain', body: syntheticMetricsText() });
    }
    if (url.pathname === '/api/ops/stream') {
      return route.fulfill({ status: 204 });
    }
    if (/^\/api\/investigations\/run-inc-demo-000[12]\/feedbacks$/.test(url.pathname)) {
      return route.fulfill({ json: { feedbacks: [] } });
    }
    if (!Object.hasOwn(tenantReads, url.pathname)) return route.fulfill({ status: 501 });

    return route.fulfill({ json: tenantReads[url.pathname](url) });
  });
}

export async function installDeterministicEnvironment(page: Page) {
  await page.clock.setFixedTime(new Date(TEST_NOW_ISO));
}
