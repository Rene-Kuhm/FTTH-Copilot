import { NextRequest, NextResponse } from 'next/server';
import { generatePrometheusMetrics } from '@/lib/metrics/prometheus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Prometheus metrics exposition endpoint (`/api/metrics`).
 *
 * Exposes real-time system, process, database, and telemetry metrics in
 * standard Prometheus exposition format (`text/plain; version=0.0.4; charset=utf-8`).
 *
 * Security:
 * If `METRICS_BEARER_TOKEN` is set in environment, enforces Bearer token authentication.
 * If unset, defaults to open access for internal Prometheus scrapers.
 */
export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  const bearerToken = process.env.METRICS_BEARER_TOKEN?.trim();

  if (bearerToken) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new NextResponse('Unauthorized: Missing or malformed Authorization header\n', {
        status: 401,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const token = authHeader.slice(7).trim();
    if (token !== bearerToken) {
      return new NextResponse('Unauthorized: Invalid bearer token\n', {
        status: 401,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  }

  try {
    const metrics = await generatePrometheusMetrics();

    return new Response(metrics, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return new NextResponse(`Error generating metrics: ${message}\n`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
