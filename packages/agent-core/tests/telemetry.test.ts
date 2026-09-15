import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OpenInferenceSpanKind,
  OpenInferenceTracer,
  PhoenixOtlpExporter,
  REDACTED_MARKER,
  SemanticAttributes,
  buildOtlpTracePayload,
  getTracer,
  redactSensitiveData,
  redactString,
  setGlobalTracer,
} from '../src/telemetry/index';

describe('OpenInference & Phoenix Observability', () => {
  describe('redaction engine', () => {
    it('redacts sensitive object keys', () => {
      const input = {
        deviceId: 'ONU-401',
        apiKey: 'super-secret-key-12345',
        password: 'admin-password',
        status: 'online',
        nested: {
          authorization: 'Bearer secret-jwt-token',
          publicInfo: 'safe',
        },
      };

      const redacted = redactSensitiveData(input) as typeof input;
      expect(redacted.deviceId).toBe('ONU-401');
      expect(redacted.status).toBe('online');
      expect(redacted.apiKey).toBe(REDACTED_MARKER);
      expect(redacted.password).toBe(REDACTED_MARKER);
      expect(redacted.nested.authorization).toBe(REDACTED_MARKER);
      expect(redacted.nested.publicInfo).toBe('safe');
    });

    it('redacts secret patterns in strings (Bearer tokens, Basic auth, URL credentials, API keys)', () => {
      expect(redactString('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test')).toBe(
        `Authorization: Bearer ${REDACTED_MARKER}`,
      );
      expect(redactString('Basic dXNlcjpwYXNz')).toBe(`Basic ${REDACTED_MARKER}`);
      expect(redactString('https://admin:pass123@router.isp.com/rest')).toBe(
        `https://admin:${REDACTED_MARKER}@router.isp.com/rest`,
      );
      expect(redactString('Failed with key: sk-abcdef123456789012345678')).toBe(
        `Failed with key: ${REDACTED_MARKER}`,
      );
    });

    it('preserves non-sensitive operational strings and numbers', () => {
      const input = 'Rx optical power is -24.5 dBm on interface gpon-olt_1/1/1:2';
      expect(redactString(input)).toBe(input);
    });

    it('redacts HTTP header-style sensitive keys (x-api-key, x-auth-token, proxy-authorization, www-authenticate)', () => {
      const input = {
        'X-Api-Key': 'sk-live-abcdef1234567890',
        x_auth_token: 'tok-1234567890abcdef',
        'Proxy-Authorization': 'Bearer proxy-jwt-secret',
        'WWW-Authenticate': 'Basic realm="api"',
        deviceId: 'ONU-401',
        status: 'online',
      };

      const redacted = redactSensitiveData(input) as typeof input;
      expect(redacted['X-Api-Key']).toBe(REDACTED_MARKER);
      expect(redacted.x_auth_token).toBe(REDACTED_MARKER);
      expect(redacted['Proxy-Authorization']).toBe(REDACTED_MARKER);
      expect(redacted['WWW-Authenticate']).toBe(REDACTED_MARKER);
      expect(redacted.deviceId).toBe('ONU-401');
      expect(redacted.status).toBe('online');
    });

    it('redacts header-style sensitive keys when nested inside other structures', () => {
      const input = {
        request: {
          headers: {
            'x-api-key': 'live-secret-1',
            'X-Auth-Token': 'live-secret-2',
          },
        },
        response: {
          headers: {
            'proxy-authorization': 'Bearer proxy-jwt',
            'www-authenticate': 'Negotiate',
          },
        },
      };

      const redacted = redactSensitiveData(input) as typeof input;
      expect(redacted.request.headers['x-api-key']).toBe(REDACTED_MARKER);
      expect(redacted.request.headers['X-Auth-Token']).toBe(REDACTED_MARKER);
      expect(redacted.response.headers['proxy-authorization']).toBe(REDACTED_MARKER);
      expect(redacted.response.headers['www-authenticate']).toBe(REDACTED_MARKER);
    });

    it('redacts sensitive header keys inside OpenTelemetry span attributes', () => {
      const tracer = new OpenInferenceTracer();
      setGlobalTracer(tracer);
      const span = tracer.startSpan('http.client.request');
      span.setAttribute('x-api-key', 'plain-secret');
      span.setAttribute('X-Auth-Token', 'plain-token');
      span.setAttribute('proxy-authorization', 'Bearer proxy-jwt');
      span.setAttribute('www-authenticate', 'Basic realm="api"');

      expect(span.attributes['x-api-key']).toBe(REDACTED_MARKER);
      expect(span.attributes['X-Auth-Token']).toBe(REDACTED_MARKER);
      expect(span.attributes['proxy-authorization']).toBe(REDACTED_MARKER);
      expect(span.attributes['www-authenticate']).toBe(REDACTED_MARKER);
    });
  });

  describe('PhoenixOtlpExporter', () => {
    it('reports isEnabled false when endpoint is unset', () => {
      const exporter = new PhoenixOtlpExporter({ endpoint: '' });
      expect(exporter.isEnabled).toBe(false);
    });

    it('formats spans into compliant OTLP JSON payload', () => {
      const tracer = new OpenInferenceTracer();
      const span = tracer.startSpan('llm.minimax', {
        kind: OpenInferenceSpanKind.LLM,
        attributes: {
          [SemanticAttributes.LLM_PROVIDER_NAME]: 'minimax',
          [SemanticAttributes.LLM_MODEL_NAME]: 'MiniMax-M3',
          [SemanticAttributes.LLM_TOKEN_COUNT_TOTAL]: 120,
        },
      });
      span.end(span.startTimeMs + 450);

      const payload = buildOtlpTracePayload([span], 'ftth-test-project') as {
        resourceSpans: Array<{
          resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
          scopeSpans: Array<{
            spans: Array<{
              name: string;
              startTimeUnixNano: string;
              endTimeUnixNano: string;
              attributes: Array<{ key: string; value: unknown }>;
              status: { code: number };
            }>;
          }>;
        }>;
      };

      expect(payload.resourceSpans).toHaveLength(1);
      const resAttrs = payload.resourceSpans[0]!.resource.attributes;
      expect(resAttrs).toContainEqual({ key: 'service.name', value: { stringValue: 'ftth-copilot' } });
      expect(resAttrs).toContainEqual({ key: 'project.name', value: { stringValue: 'ftth-test-project' } });

      const exportedSpan = payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
      expect(exportedSpan.name).toBe('llm.minimax');
      expect(exportedSpan.status.code).toBe(1); // OK
      expect(BigInt(exportedSpan.endTimeUnixNano)).toBeGreaterThan(BigInt(exportedSpan.startTimeUnixNano));
    });

    it('exports spans via HTTP fetch without throwing on failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const exporter = new PhoenixOtlpExporter({
        endpoint: 'http://localhost:6006/v1/traces',
        projectName: 'ftth-copilot',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(exporter.isEnabled).toBe(true);

      const tracer = new OpenInferenceTracer();
      const span = tracer.startSpan('agent.run', { kind: OpenInferenceSpanKind.AGENT });
      span.end();

      const ok = await exporter.export([span]);
      expect(ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6006/v1/traces',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('safely handles network errors without crashing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      const exporter = new PhoenixOtlpExporter({
        endpoint: 'http://localhost:6006/v1/traces',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      const tracer = new OpenInferenceTracer();
      const span = tracer.startSpan('agent.run');
      span.end();

      const ok = await exporter.export([span]);
      expect(ok).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('OpenInferenceTracer context and span hierarchy', () => {
    let tracer: OpenInferenceTracer;

    beforeEach(() => {
      tracer = new OpenInferenceTracer();
      setGlobalTracer(tracer);
    });

    it('tracks parent-child hierarchy in nested withSpan execution', async () => {
      await tracer.withSpan(
        'agent.run',
        {
          kind: OpenInferenceSpanKind.AGENT,
          attributes: { [SemanticAttributes.USER_ID]: 'usr-1' },
        },
        async (rootSpan) => {
          await tracer.withSpan(
            'retrieval.relevant_incidents',
            { kind: OpenInferenceSpanKind.RETRIEVER },
            async (retrieverSpan) => {
              retrieverSpan.setAttribute('retrieval.count', 3);
            },
          );

          await tracer.withSpan(
            'llm.minimax',
            { kind: OpenInferenceSpanKind.LLM },
            async (llmSpan) => {
              llmSpan.setAttribute(SemanticAttributes.LLM_MODEL_NAME, 'MiniMax-M3');
            },
          );
        },
      );

      const spans = tracer.getCompletedSpans();
      expect(spans).toHaveLength(3);

      const retrieverSpan = spans.find((s) => s.name === 'retrieval.relevant_incidents')!;
      const llmSpan = spans.find((s) => s.name === 'llm.minimax')!;
      const rootSpan = spans.find((s) => s.name === 'agent.run')!;

      // All spans in the execution share the same traceId
      expect(retrieverSpan.context.traceId).toBe(rootSpan.context.traceId);
      expect(llmSpan.context.traceId).toBe(rootSpan.context.traceId);

      // Children reference the root span's spanId as parentSpanId
      expect(retrieverSpan.parentSpanId).toBe(rootSpan.context.spanId);
      expect(llmSpan.parentSpanId).toBe(rootSpan.context.spanId);
      expect(rootSpan.parentSpanId).toBeUndefined();
    });

    it('records ERROR status and message when span callback throws', async () => {
      await expect(
        tracer.withSpan('tool.failing', { kind: OpenInferenceSpanKind.TOOL }, async () => {
          throw new Error('NMS timeout with Bearer token-12345');
        }),
      ).rejects.toThrow('NMS timeout');

      const spans = tracer.getCompletedSpans();
      expect(spans).toHaveLength(1);
      const span = spans[0]!;
      expect(span.status.code).toBe('ERROR');
      // Verify sensitive token in error message was redacted
      expect(span.status.message).toContain(REDACTED_MARKER);
      expect(span.status.message).not.toContain('token-12345');
    });

    it('redacts sensitive attributes automatically', () => {
      const span = tracer.startSpan('llm.request');
      span.setAttribute('password', 'unredacted-secret');
      span.setJsonAttribute('credentials', { apiKey: 'key-9876' });

      expect(span.attributes['password']).toBe(REDACTED_MARKER);
      expect(span.attributes['credentials']).toContain(REDACTED_MARKER);
    });
  });
});
