// Proxy route: Next.js → VictoriaMetrics
// Keeps the VM endpoint private (no bearer token exposed to browser).
// GET /api/vm/query?query=<promql>&range=<seconds>

import { NextRequest, NextResponse } from 'next/server';

// Set VICTORIAMETRICS_URL in .env or docker-compose.yml:
//   Dev (host):   http://localhost:8428
//   Docker:       http://victoriametrics:8428
const VM_URL = process.env.VICTORIAMETRICS_URL ?? 'http://localhost:8428';
const METRICS_BEARER_TOKEN = process.env.METRICS_BEARER_TOKEN ?? '';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const query = searchParams.get('query');
  const range = searchParams.get('range') ?? '3600'; // default 1h

  if (!query) {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
  }

  const url = `${VM_URL}/api/v1/query_range?query=${encodeURIComponent(query)}&start=now-${range}s&end=now&step=30s`;

  const headers: HeadersInit = {};
  if (METRICS_BEARER_TOKEN) {
    headers['Authorization'] = `Bearer ${METRICS_BEARER_TOKEN}`;
  }

  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[vm/query]', err);
    return NextResponse.json(
      { error: 'Failed to query VictoriaMetrics', detail: String(err) },
      { status: 502 }
    );
  }
}
