// Instant query: single value snapshot
// GET /api/vm/instant?query=<promql>

import { NextRequest, NextResponse } from 'next/server';

const VM_URL = process.env.VICTORIAMETRICS_URL ?? 'http://localhost:8428';
const METRICS_BEARER_TOKEN = process.env.METRICS_BEARER_TOKEN ?? '';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const query = searchParams.get('query');

  if (!query) {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
  }

  const url = `${VM_URL}/api/v1/query?query=${encodeURIComponent(query)}`;

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
    console.error('[vm/instant]', err);
    return NextResponse.json(
      { error: 'Failed to query VictoriaMetrics', detail: String(err) },
      { status: 502 }
    );
  }
}
