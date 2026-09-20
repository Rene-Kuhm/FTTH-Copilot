/**
 * OpenTelemetry / Phoenix OTLP HTTP Exporter.
 * Converts telemetry spans into standard OTLP JSON and exports them to Arize Phoenix.
 */

import type { TelemetrySpan } from './openinference';

export interface PhoenixExporterConfig {
  endpoint?: string;
  projectName?: string;
  fetchImpl?: typeof fetch;
}

export function toOtlpValue(value: string | number | boolean): Record<string, unknown> {
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'boolean') {
    return { boolValue: value };
  }
  if (Number.isInteger(value)) {
    return { intValue: String(value) };
  }
  return { doubleValue: value };
}

export function buildOtlpTracePayload(
  spans: TelemetrySpan[],
  projectName = 'ftth-copilot',
): Record<string, unknown> {
  const formattedSpans = spans.map((span) => {
    const startNano = BigInt(span.startTimeMs) * 1_000_000n;
    const endNano = BigInt(span.endTimeMs ?? span.startTimeMs) * 1_000_000n;

    return {
      traceId: span.context.traceId,
      spanId: span.context.spanId,
      parentSpanId: span.parentSpanId || undefined,
      name: span.name,
      kind: 1, // SPAN_KIND_INTERNAL
      startTimeUnixNano: startNano.toString(),
      endTimeUnixNano: endNano.toString(),
      attributes: Object.entries(span.attributes).map(([key, val]) => ({
        key,
        value: toOtlpValue(val),
      })),
      status: {
        code: span.status.code === 'ERROR' ? 2 : 1, // 1: OK, 2: ERROR
        message: span.status.message,
      },
    };
  });

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'ftth-copilot' } },
            { key: 'project.name', value: { stringValue: projectName } },
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: 'openinference.ftth-copilot',
              version: '0.2.2',
            },
            spans: formattedSpans,
          },
        ],
      },
    ],
  };
}

export class PhoenixOtlpExporter {
  private readonly endpoint?: string;
  private readonly projectName: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config?: PhoenixExporterConfig) {
    this.endpoint = config?.endpoint ?? process.env['PHOENIX_COLLECTOR_ENDPOINT'];
    this.projectName =
      config?.projectName ?? process.env['PHOENIX_PROJECT_NAME'] ?? 'ftth-copilot';
    this.fetchImpl = config?.fetchImpl ?? fetch;
  }

  get isEnabled(): boolean {
    return Boolean(this.endpoint && this.endpoint.trim().length > 0);
  }

  async export(spans: TelemetrySpan[]): Promise<boolean> {
    if (!this.isEnabled || spans.length === 0) {
      return false;
    }

    try {
      const payload = buildOtlpTracePayload(spans, this.projectName);
      const res = await this.fetchImpl(this.endpoint!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.warn(
          `[phoenix-exporter] Failed to export ${spans.length} spans: HTTP ${res.status}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[phoenix-exporter] Error exporting spans:', err);
      return false;
    }
  }
}
