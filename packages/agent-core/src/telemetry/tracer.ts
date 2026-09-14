import { randomBytes } from 'node:crypto';
import {
  SemanticAttributes,
  type OpenInferenceSpanKindType,
  type SpanContext,
  type SpanStatus,
  type TelemetrySpan,
} from './openinference';
import { PhoenixOtlpExporter, type PhoenixExporterConfig } from './exporter';
import { isSensitiveKey, redactSensitiveData, redactString, REDACTED_MARKER } from './redaction';

export interface StartSpanOptions {
  kind?: OpenInferenceSpanKindType;
  parentSpanId?: string;
  traceId?: string;
  attributes?: Record<string, string | number | boolean>;
}

export class Span implements TelemetrySpan {
  readonly name: string;
  readonly context: SpanContext;
  readonly parentSpanId?: string;
  readonly startTimeMs: number;
  endTimeMs?: number;
  readonly attributes: Record<string, string | number | boolean>;
  readonly events: Array<{ name: string; timestampMs: number; attributes?: Record<string, unknown> }>;
  status: SpanStatus;

  constructor(name: string, context: SpanContext, parentSpanId?: string, startTimeMs = Date.now()) {
    this.name = name;
    this.context = context;
    this.parentSpanId = parentSpanId;
    this.startTimeMs = startTimeMs;
    this.attributes = {};
    this.events = [];
    this.status = { code: 'OK' };
  }

  setAttribute(key: string, value: string | number | boolean): this {
    if (isSensitiveKey(key)) {
      this.attributes[key] = REDACTED_MARKER;
      return this;
    }
    if (typeof value === 'string') {
      this.attributes[key] = redactString(value);
    } else {
      this.attributes[key] = value;
    }
    return this;
  }

  setAttributes(attrs: Record<string, string | number | boolean>): this {
    for (const [key, val] of Object.entries(attrs)) {
      this.setAttribute(key, val);
    }
    return this;
  }

  setJsonAttribute(key: string, value: unknown): this {
    const redacted = redactSensitiveData(value);
    try {
      this.attributes[key] = JSON.stringify(redacted);
    } catch {
      this.attributes[key] = String(redacted);
    }
    return this;
  }

  setStatus(code: 'OK' | 'ERROR', message?: string): this {
    this.status = {
      code,
      message: message ? redactString(message) : undefined,
    };
    return this;
  }

  end(endTimeMs = Date.now()): void {
    if (this.endTimeMs === undefined) {
      this.endTimeMs = endTimeMs;
    }
  }
}

export class OpenInferenceTracer {
  private readonly exporter: PhoenixOtlpExporter;
  private readonly completedSpans: TelemetrySpan[] = [];
  private activeTraceId?: string;
  private activeSpanId?: string;

  constructor(exporterConfig?: PhoenixExporterConfig) {
    this.exporter = new PhoenixOtlpExporter(exporterConfig);
  }

  generateTraceId(): string {
    return randomBytes(16).toString('hex'); // 32 hex chars
  }

  generateSpanId(): string {
    return randomBytes(8).toString('hex'); // 16 hex chars
  }

  startSpan(name: string, options: StartSpanOptions = {}): Span {
    const traceId = options.traceId ?? this.activeTraceId ?? this.generateTraceId();
    const spanId = this.generateSpanId();
    const parentSpanId = options.parentSpanId ?? this.activeSpanId;

    const span = new Span(name, { traceId, spanId }, parentSpanId);

    if (options.kind) {
      span.setAttribute(SemanticAttributes.OPENINFERENCE_SPAN_KIND, options.kind);
    }

    if (options.attributes) {
      span.setAttributes(options.attributes);
    }

    return span;
  }

  async withSpan<T>(
    name: string,
    options: StartSpanOptions,
    fn: (span: Span) => Promise<T> | T,
  ): Promise<T> {
    const span = this.startSpan(name, options);

    const prevTraceId = this.activeTraceId;
    const prevSpanId = this.activeSpanId;
    this.activeTraceId = span.context.traceId;
    this.activeSpanId = span.context.spanId;

    try {
      const result = await fn(span);
      span.end();
      this.recordSpan(span);
      return result;
    } catch (error) {
      span.setStatus('ERROR', error instanceof Error ? error.message : String(error));
      span.end();
      this.recordSpan(span);
      throw error;
    } finally {
      this.activeTraceId = prevTraceId;
      this.activeSpanId = prevSpanId;
    }
  }

  recordSpan(span: TelemetrySpan): void {
    this.completedSpans.push(span);
    // Non-blocking export if configured
    if (this.exporter.isEnabled) {
      void this.exporter.export([span]);
    }
  }

  getCompletedSpans(): TelemetrySpan[] {
    return [...this.completedSpans];
  }

  clear(): void {
    this.completedSpans.length = 0;
    this.activeTraceId = undefined;
    this.activeSpanId = undefined;
  }
}

let globalTracer: OpenInferenceTracer | undefined;

export function getTracer(): OpenInferenceTracer {
  if (!globalTracer) {
    globalTracer = new OpenInferenceTracer();
  }
  return globalTracer;
}

export function setGlobalTracer(tracer: OpenInferenceTracer | undefined): void {
  globalTracer = tracer;
}
