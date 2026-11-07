/**
 * Eventos en tiempo real de SmartOLT (S3) y presupuesto por cuenta.
 *
 * La API de octubre 2026 publica `GET /api/onu/get_event_stream?events=…`, que
 * devuelve `{ status, response: { url, expires_in } }`. La `url` se abre con un
 * cliente SSE: cada evento trae `id`, `event` y `data`; el stream se cierra a
 * la hora y se vuelve a pedir la URL mandando el último `id` en `Last-Event-ID`.
 * El endpoint se puede llamar 60 veces por hora y hay tres eventos de control
 * (`resync`, `expired`, `disabled`).
 *
 * Estas pruebas fijan: el parseo de los frames SSE, la validación tipada del
 * cuerpo de cada evento, la reconexión con `Last-Event-ID`, los tres eventos de
 * control, el presupuesto de 60/hora del endpoint, la caída a polling cuando el
 * stream no está disponible (503) o la clave no es de cliente (403) y que ni el
 * `X-Token` ni el token de la URL del stream viajen en un mensaje.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsafeNmsUrlError } from '@ftth-copilot/connectors-core';
import {
  SMARTOLT_EVENT_TYPES,
  parseEventStreamResponse,
  parseSmartoltEventBatch,
  parseSmartoltEventData,
} from '../src/schemas';
import {
  SmartoltEventStream,
  SmartoltSseParser,
  assertStreamUrlBelongsToBase,
  type SmartoltStreamOutcome,
} from '../src/events';
import { SmartoltHourlyBudget } from '../src/rate-limit';
import { SmartoltEventStreamError, SmartoltRateLimitError } from '../src/errors';
import { __resetSmartoltAccountBudgetsForTests } from '../src/rate-limit-registry';

const API_BASE = 'https://demo.smartolt.com';
const API_KEY = 'sk-secret-token-1234';
const STREAM_HOST = 'https://demo.smartolt.com:8443';
const STREAM_URL = `${STREAM_HOST}/onu-status/stream?token=stream-token-secret`;

/** Un reloj que no duerme: anota la espera y adelanta el tiempo. */
function fakeClock(startMs = 1_000_000): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
} {
  let current = startMs;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    sleeps,
  };
}

/** Un cuerpo SSE ya codificado, entregado en los trozos que se le pasan. */
function sseResponse(frames: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/**
 * Un cuerpo SSE que no se cierra solo.
 *
 * Es el stream real: el proveedor lo deja abierto entre frames y sólo lo
 * termina cuando se cumple la hora (o cuando quien lo lee lo cancela). El
 * contador prueba que el cliente soltó el socket.
 */
function heldSseResponse(
  frames: string[],
  counter: { cancelled: number },
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
    },
    cancel() {
      counter.cancelled += 1;
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

interface StreamHarness {
  fetchImpl: typeof fetch;
  requests: Array<{ url: string; headers: Record<string, string> }>;
}

/**
 * Un SmartOLT de mentira con dos caras: el endpoint que entrega la URL del
 * stream y el stream en sí. Cada llamada al endpoint consume la siguiente URL
 * del guion; cada apertura del stream consume el siguiente cuerpo.
 */
function streamHarness(script: {
  urls?: Array<string | { status: number; body?: unknown }>;
  streams?: Array<Response | (() => Response)>;
}): StreamHarness {
  const requests: StreamHarness['requests'] = [];
  const urls = script.urls ?? [STREAM_URL];
  const streams = script.streams ?? [];
  let urlIndex = 0;
  let streamIndex = 0;

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = String(value);
    }
    requests.push({ url: raw, headers });
    const url = new URL(raw);

    if (url.pathname === '/api/onu/get_event_stream') {
      const next = urls[Math.min(urlIndex, urls.length - 1)];
      urlIndex += 1;
      if (typeof next === 'string') {
        return jsonResponse({ status: true, response: { url: next, expires_in: 900 } });
      }
      return jsonResponse(next.body ?? { status: false, error: 'unavailable' }, next.status);
    }

    const next = streams[Math.min(streamIndex, streams.length - 1)];
    streamIndex += 1;
    if (!next) throw new Error('sin cuerpo SSE mockeado');
    return typeof next === 'function' ? next() : next;
  }) as unknown as typeof fetch;

  return { fetchImpl, requests };
}

/** Consume hasta `count` resultados del stream (o hasta que termine). */
async function collect(
  stream: SmartoltEventStream,
  count: number,
  options: { signal?: AbortSignal } = {},
): Promise<SmartoltStreamOutcome[]> {
  const out: SmartoltStreamOutcome[] = [];
  for await (const outcome of stream.events(options)) {
    out.push(outcome);
    if (out.length >= count) break;
  }
  return out;
}

function newStream(
  harness: StreamHarness,
  clock: ReturnType<typeof fakeClock>,
  overrides: {
    endpointPerHour?: number;
    initialBackoffMs?: number;
    maxBackoffMs?: number;
  } = {},
): SmartoltEventStream {
  return new SmartoltEventStream({
    apiKey: API_KEY,
    apiBaseUrl: API_BASE,
    fetchImpl: harness.fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
    ...overrides,
  });
}

const STATUS_FRAME =
  'id: 1\nevent: onu.status_changed\ndata: {"type":"onu.status_changed","timestamp":"2026-10-08T10:00:00Z",' +
  '"data":{"onus":[{"unique_external_id":"ext-1001","sn":"HWTC00000015","olt_id":"1","board":"0","port":"5",' +
  '"onu":"15","status":"LOS","last_status_change":"2026-10-08 10:00:00.123456"}]}}\n\n';

const SIGNAL_FRAME =
  'id: 2\nevent: onu.signal_reading\ndata: {"type":"onu.signal_reading","timestamp":"2026-10-08T10:00:01Z",' +
  '"data":{"onus":[{"unique_external_id":"ext-1001","sn":"HWTC00000015","olt_id":"1","rx1310":-21,' +
  '"band":"Very good","reading_at":"2026-10-08 10:00:00"}]}}\n\n';

beforeEach(() => {
  __resetSmartoltAccountBudgetsForTests();
});

describe('el parser de frames SSE', () => {
  it('entrega id, event y data de un frame completo', () => {
    const parser = new SmartoltSseParser();

    const items = parser.feed('id: 7\nevent: onu.status_changed\ndata: {"a":1}\n\n');

    expect(items).toEqual([
      { kind: 'frame', frame: { id: '7', event: 'onu.status_changed', data: '{"a":1}' } },
    ]);
  });

  it('une las líneas de data con un salto de línea', () => {
    const parser = new SmartoltSseParser();

    const items = parser.feed('event: x\ndata: {"a":\ndata: 1}\n\n');

    expect(items).toEqual([{ kind: 'frame', frame: { event: 'x', data: '{"a":\n1}' } }]);
  });

  it('reporta los comentarios (el `: ping` que mantiene vivo el stream)', () => {
    const parser = new SmartoltSseParser();

    expect(parser.feed(': ping\n\n')).toEqual([{ kind: 'comment', comment: 'ping' }]);
  });

  it('acepta CRLF y un frame partido entre dos trozos', () => {
    const parser = new SmartoltSseParser();

    const first = parser.feed('id: 9\r\nevent: onu.auth');
    const second = parser.feed('orized\r\ndata: {}\r\n\r\n');

    expect(first).toEqual([]);
    expect(second).toEqual([
      { kind: 'frame', frame: { id: '9', event: 'onu.authorized', data: '{}' } },
    ]);
  });

  it('ignora los campos que no usa (`retry`, desconocidos) y respeta el valor sin espacio', () => {
    const parser = new SmartoltSseParser();

    const items = parser.feed('retry: 5000\nfoo: bar\nevent:resync\n\n');

    expect(items).toEqual([{ kind: 'frame', frame: { event: 'resync', data: '' } }]);
  });

  it('no entrega un frame vacío', () => {
    const parser = new SmartoltSseParser();

    expect(parser.feed('\n\n')).toEqual([]);
  });
});

describe('el sobre de get_event_stream', () => {
  it('lee la URL y el vencimiento del ejemplo de la especificación', () => {
    const parsed = parseEventStreamResponse({
      status: true,
      response: { url: STREAM_URL, expires_in: 900 },
      response_code: 'success',
    });

    expect(parsed).toEqual({ status: true, url: STREAM_URL, expiresInSeconds: 900 });
  });

  it('usa 900 segundos cuando el sobre no publica `expires_in`', () => {
    const parsed = parseEventStreamResponse({ status: true, response: { url: STREAM_URL } });

    expect(parsed.expiresInSeconds).toBe(900);
  });

  it('falla con un error de forma cuando falta la URL', () => {
    expect(() => parseEventStreamResponse({ status: true, response: {} })).toThrow(
      /respuesta inesperada en/,
    );
  });
});

describe('el cuerpo de un evento', () => {
  it('parsea el ejemplo oficial de onu.status_changed', () => {
    const batch = parseSmartoltEventData(
      JSON.stringify({
        type: 'onu.status_changed',
        timestamp: '2026-10-08T10:00:01Z',
        data: {
          onus: [
            {
              unique_external_id: 'ext-1001',
              sn: 'HWTC00000015',
              olt_id: '1',
              status: 'LOS',
              status_observed_at: '2026-10-08 10:01:00',
            },
          ],
        },
      }),
    );

    expect(batch.type).toBe('onu.status_changed');
    expect(batch.family).toBe('onus');
    expect(batch.rows).toHaveLength(1);
    expect(batch.rows[0]?.['status']).toBe('LOS');
  });

  it('reconoce la familia de PON y de OLT', () => {
    const pons = parseSmartoltEventData(
      JSON.stringify({
        type: 'pon.outage_started',
        data: { pons: [{ olt_id: '11', board: '2', port: '3', los_count: '8' }] },
      }),
    );
    const olts = parseSmartoltEventData(
      JSON.stringify({
        type: 'olt.status_stale',
        data: { olts: [{ olt_id: 11, olt_name: 'OLT 11' }] },
      }),
    );

    expect(pons.family).toBe('pons');
    expect(olts.family).toBe('olts');
  });

  it('acepta los tipos que la especificación publica', () => {
    for (const type of SMARTOLT_EVENT_TYPES) {
      expect(SMARTOLT_EVENT_TYPES).toContain(type);
    }
    expect(SMARTOLT_EVENT_TYPES).toHaveLength(12);
  });

  it('rechaza un tipo de evento desconocido', () => {
    expect(() =>
      parseSmartoltEventData(JSON.stringify({ type: 'onu.exploded', data: { onus: [] } })),
    ).toThrow(/tipo de evento/);
  });

  it('rechaza una fila sin los campos que el conector consume', () => {
    expect(() =>
      parseSmartoltEventData(
        JSON.stringify({ type: 'onu.signal_changed', data: { onus: [{ sn: 'X' }] } }),
      ),
    ).toThrow(/rx1310/);
  });

  it('acepta el número como texto, que es como lo manda algún firmware', () => {
    const batch = parseSmartoltEventData(
      JSON.stringify({
        type: 'onu.signal_reading',
        data: { onus: [{ sn: 'X', rx1310: '-21.5', reading_at: '2026-10-08 10:00:00' }] },
      }),
    );

    expect(batch.rows[0]?.['rx1310']).toBe('-21.5');
  });

  it('rechaza un lote de más de 1000 filas, que es el tope del proveedor', () => {
    const rows = Array.from({ length: 1_001 }, (_, i) => ({ sn: `SN-${i}`, status: 'Online' }));

    expect(() =>
      parseSmartoltEventData(JSON.stringify({ type: 'onu.status_changed', data: { onus: rows } })),
    ).toThrow(/1000/);
  });

  it('rechaza un cuerpo que no es JSON', () => {
    expect(() => parseSmartoltEventData('no es json')).toThrow(/no es JSON/);
  });

  it('parseSmartoltEventBatch acepta el cuerpo ya parseado', () => {
    const batch = parseSmartoltEventBatch({
      type: 'onu.rx1490_reading',
      data: { onus: [{ sn: 'SN-1', rx1490: -18.42, reading_at: '2026-10-08 10:00:00' }] },
    });

    expect(batch.type).toBe('onu.rx1490_reading');
    expect(batch.rows[0]?.['rx1490']).toBe(-18.42);
  });
});

describe('la URL del stream', () => {
  it('acepta una URL del mismo host que la API, con su token', () => {
    expect(assertStreamUrlBelongsToBase(STREAM_URL, API_BASE).hostname).toBe('demo.smartolt.com');
  });

  it('rechaza una URL de otro host', () => {
    expect(() =>
      assertStreamUrlBelongsToBase('https://evil.example.com/stream?token=x', API_BASE),
    ).toThrow(UnsafeNmsUrlError);
  });

  it('rechaza http y las credenciales embebidas', () => {
    expect(() => assertStreamUrlBelongsToBase('http://demo.smartolt.com/x', API_BASE)).toThrow(
      UnsafeNmsUrlError,
    );
    expect(() =>
      assertStreamUrlBelongsToBase('https://user:pass@demo.smartolt.com/x', API_BASE),
    ).toThrow(UnsafeNmsUrlError);
  });
});

describe('el cliente del stream', () => {
  it('pide la URL con la lista de eventos y abre el stream con el X-Token de la API', async () => {
    const clock = fakeClock();
    const harness = streamHarness({ streams: [() => sseResponse([STATUS_FRAME])] });
    const stream = newStream(harness, clock);

    const outcomes = await collect(stream, 1);

    expect(outcomes[0]).toMatchObject({
      kind: 'event',
      id: '1',
      batch: { type: 'onu.status_changed' },
    });
    const endpointCall = harness.requests[0];
    expect(endpointCall).toBeDefined();
    const url = new URL(endpointCall!.url);
    expect(url.pathname).toBe('/api/onu/get_event_stream');
    expect(url.searchParams.get('events')).toBe([...SMARTOLT_EVENT_TYPES].join(','));
    expect(endpointCall!.headers['x-token']).toBe(API_KEY);
    // El stream se abre contra la URL entregada, sin el X-Token.
    expect(harness.requests[1]?.url).toBe(STREAM_URL);
    expect(harness.requests[1]?.headers['x-token']).toBeUndefined();
  });

  it('entrega el ping del comentario para que el dueño del loop vea que el stream vive', async () => {
    const clock = fakeClock();
    const harness = streamHarness({
      streams: [() => sseResponse([': ping\n\n', STATUS_FRAME])],
    });

    const outcomes = await collect(newStream(harness, clock), 2);

    expect(outcomes[0]).toEqual({ kind: 'ping' });
    expect(outcomes[1]).toMatchObject({ kind: 'event', id: '1' });
  });

  it('se reconecta con el último id en Last-Event-ID y sigue entregando eventos', async () => {
    const clock = fakeClock();
    const harness = streamHarness({
      streams: [
        () => sseResponse([STATUS_FRAME]),
        () => sseResponse([SIGNAL_FRAME]),
      ],
    });

    const outcomes = await collect(newStream(harness, clock), 2);

    expect(outcomes.map((outcome) => (outcome as { id: string }).id)).toEqual(['1', '2']);
    // Dos llamadas al endpoint (la segunda reconexión) y dos aperturas de stream.
    const endpointCalls = harness.requests.filter(
      (request) => new URL(request.url).pathname === '/api/onu/get_event_stream',
    );
    expect(endpointCalls).toHaveLength(2);
    const reopened = harness.requests.filter((request) => request.url === STREAM_URL)[1];
    expect(reopened?.headers['last-event-id']).toBe('1');
    expect(clock.sleeps[0]).toBe(1_000);
  });

  it('resync se entrega y el stream sigue; expired pide una URL nueva; disabled termina', async () => {
    const clock = fakeClock();
    const resync = newStream(
      streamHarness({
        streams: [
          () =>
            sseResponse([
              'id: 3\nevent: resync\ndata: {}\n\n',
              'id: 4\nevent: onu.status_changed\ndata: {"type":"onu.status_changed","data":{"onus":[{"sn":"SN-1","status":"Online"}]}}\n\n',
            ]),
        ],
      }),
      clock,
    );

    const resyncOutcomes = await collect(resync, 2);
    expect(resyncOutcomes[0]).toEqual({ kind: 'resync', id: '3' });
    expect(resyncOutcomes[1]).toMatchObject({ kind: 'event', id: '4' });

    const expiredHarness = streamHarness({
      streams: [
        () => sseResponse(['id: 5\nevent: expired\ndata: {}\n\n']),
        () => sseResponse([SIGNAL_FRAME]),
      ],
    });
    const expiredOutcomes = await collect(newStream(expiredHarness, fakeClock()), 2);
    expect(expiredOutcomes[0]).toEqual({ kind: 'expired', id: '5' });
    expect(expiredOutcomes[1]).toMatchObject({ kind: 'event', id: '2' });

    const disabledHarness = streamHarness({
      streams: [() => sseResponse(['id: 6\nevent: disabled\ndata: {}\n\n', STATUS_FRAME])],
    });
    const disabledOutcomes = await collect(newStream(disabledHarness, fakeClock()), 5);
    expect(disabledOutcomes).toEqual([{ kind: 'disabled', id: '6' }]);
    expect(
      disabledHarness.requests.filter(
        (request) => new URL(request.url).pathname === '/api/onu/get_event_stream',
      ),
    ).toHaveLength(1);
  });

  it('cae a polling cuando el endpoint responde 503 y no abre ningún stream', async () => {
    const harness = streamHarness({
      urls: [{ status: 503, body: { status: false, error: 'ONU status push is not available right now.' } }],
    });

    const outcomes = await collect(newStream(harness, fakeClock()), 5);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'fallback_polling', status: 503 });
    expect(harness.requests).toHaveLength(1);
  });

  it('cae a polling cuando la clave no es de cliente (403)', async () => {
    const harness = streamHarness({
      urls: [{ status: 403, body: { status: false, error: 'Forbidden' } }],
    });

    const outcomes = await collect(newStream(harness, fakeClock()), 5);

    expect(outcomes[0]).toMatchObject({ kind: 'fallback_polling', status: 403 });
  });

  it('falla con un error tipado cuando la lista de eventos trae un tipo desconocido (400)', async () => {
    const harness = streamHarness({
      urls: [{ status: 400, body: { status: false, error: 'Invalid parameters: Invalid events.' } }],
    });

    const error = await collect(newStream(harness, fakeClock()), 5).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartoltEventStreamError);
    expect((error as SmartoltEventStreamError).status).toBe(400);
    expect((error as SmartoltEventStreamError).reason).toBe('unknown_event_type');
  });

  it('respeta el presupuesto del endpoint: la reconexión que pasa el tope falla tipada', async () => {
    const clock = fakeClock();
    const harness = streamHarness({
      streams: [
        () => sseResponse([STATUS_FRAME]),
        () => sseResponse([SIGNAL_FRAME]),
      ],
    });

    const error = await collect(
      newStream(harness, clock, { endpointPerHour: 1 }),
      5,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartoltRateLimitError);
    expect((error as SmartoltRateLimitError).violationType).toBe('per_endpoint');
    expect(harness.requests.filter((r) => new URL(r.url).pathname === '/api/onu/get_event_stream')).toHaveLength(1);
  });

  it('reintenta con backoff acotado cuando abrir el stream falla', async () => {
    const clock = fakeClock();
    const harness = streamHarness({
      streams: [
        () => new Response('boom', { status: 500 }),
        () => new Response('boom', { status: 500 }),
        () => sseResponse([STATUS_FRAME]),
      ],
    });

    const outcomes = await collect(
      newStream(harness, clock, { initialBackoffMs: 500, maxBackoffMs: 800 }),
      3,
    );

    expect(outcomes[0]).toMatchObject({ kind: 'error' });
    expect(outcomes[1]).toMatchObject({ kind: 'error' });
    expect(outcomes[2]).toMatchObject({ kind: 'event', id: '1' });
    expect(clock.sleeps).toEqual([500, 800]);
  });

  it('entrega un evento inválido como resultado y sigue con el siguiente', async () => {
    const clock = fakeClock();
    const harness = streamHarness({
      streams: [
        () =>
          sseResponse([
            'id: 1\nevent: onu.status_changed\ndata: {"type":"onu.exploded","data":{"onus":[]}}\n\n',
            SIGNAL_FRAME,
          ]),
      ],
    });

    const outcomes = await collect(newStream(harness, clock), 2);

    expect(outcomes[0]).toMatchObject({ kind: 'invalid', id: '1' });
    expect(outcomes[1]).toMatchObject({ kind: 'event', id: '2' });
  });

  it('no abre un stream en otro host: reporta el error y no llama al host ajeno', async () => {
    const clock = fakeClock();
    const harness = streamHarness({
      urls: ['https://evil.example.com/onu-status/stream?token=x'],
    });

    const outcomes = await collect(newStream(harness, clock), 1);

    expect(outcomes[0]).toMatchObject({ kind: 'error' });
    expect(harness.requests.some((request) => request.url.includes('evil.example.com'))).toBe(false);
  });

  it('nunca deja el token del stream ni el X-Token en un mensaje', async () => {
    const clock = fakeClock();
    const harness = streamHarness({
      urls: [{ status: 503, body: { status: false, error: 'unavailable' } }],
    });

    const outcomes = await collect(newStream(harness, clock), 1);
    const text = JSON.stringify(outcomes);

    expect(text).not.toContain('stream-token-secret');
    expect(text).not.toContain(API_KEY);
    expect(text).toContain('503');
  });
});

describe('cuándo suelta el stream', () => {
  it('cancela el cuerpo del stream anterior al reconectar por `expired`', async () => {
    const counter = { cancelled: 0 };
    const harness = streamHarness({
      streams: [
        () => heldSseResponse(['id: 5\nevent: expired\ndata: {}\n\n'], counter),
        () => sseResponse([SIGNAL_FRAME]),
      ],
    });

    const outcomes = await collect(newStream(harness, fakeClock()), 2);

    expect(outcomes[0]).toEqual({ kind: 'expired', id: '5' });
    expect(outcomes[1]).toMatchObject({ kind: 'event', id: '2' });
    // La URL vence cada 15 minutos y el stream cierra a la hora: si el cuerpo
    // anterior no se cancela, cada reconexión deja un socket abierto.
    expect(counter.cancelled).toBe(1);
  });

  it('cancela el cuerpo cuando el consumidor corta la iteración', async () => {
    const counter = { cancelled: 0 };
    const harness = streamHarness({
      streams: [() => heldSseResponse([STATUS_FRAME], counter)],
    });

    await collect(newStream(harness, fakeClock()), 1);

    expect(counter.cancelled).toBe(1);
  });
});

describe('el aborto del consumidor', () => {
  it('un abort durante el backoff termina el generador sin esperar el backoff entero', async () => {
    const harness = streamHarness({ streams: [() => new Response('boom', { status: 500 })] });
    const stream = new SmartoltEventStream({
      apiKey: API_KEY,
      apiBaseUrl: API_BASE,
      fetchImpl: harness.fetchImpl,
      initialBackoffMs: 1_200,
      maxBackoffMs: 1_200,
    });
    const controller = new AbortController();
    const outcomes: SmartoltStreamOutcome[] = [];

    const startedAt = performance.now();
    for await (const outcome of stream.events({ signal: controller.signal })) {
      outcomes.push(outcome);
      // El worker se apaga mientras el cliente espera el reintento.
      controller.abort();
    }
    const elapsedMs = performance.now() - startedAt;

    expect(outcomes).toEqual([expect.objectContaining({ kind: 'error' })]);
    expect(elapsedMs).toBeLessThan(100);
  });

  it('un abort corta el pedido de la URL del stream en vuelo', async () => {
    const seenSignals: AbortSignal[] = [];
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal === undefined || signal === null) return;
          seenSignals.push(signal);
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        }),
    ) as unknown as typeof fetch;
    const stream = new SmartoltEventStream({
      apiKey: API_KEY,
      apiBaseUrl: API_BASE,
      fetchImpl,
    });
    const controller = new AbortController();
    const first = stream.events({ signal: controller.signal }).next();

    // El pedido de URL ya salió: el apagado tiene que cortarlo.
    await vi.waitFor(() => expect(seenSignals).toHaveLength(1));
    const abortedAt = performance.now();
    controller.abort();
    const result = await Promise.race([
      first,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 1_000)),
    ]);
    const elapsedMs = performance.now() - abortedAt;

    expect(result).toEqual({ done: true, value: undefined });
    expect(elapsedMs).toBeLessThan(100);
  });
});

describe('el presupuesto por hora de un endpoint', () => {
  it('admite las llamadas del presupuesto y falla tipado al pasarse', () => {
    const clock = fakeClock();
    const budget = new SmartoltHourlyBudget(2, clock);

    budget.consume('/api/onu/get_event_stream');
    budget.consume('/api/onu/get_event_stream');

    let error: unknown;
    try {
      budget.consume('/api/onu/get_event_stream');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SmartoltRateLimitError);
    expect((error as SmartoltRateLimitError).violationType).toBe('per_endpoint');
    expect((error as SmartoltRateLimitError).retryAfterSeconds).toBe(3_600);
    expect(budget.used).toBe(2);
  });

  it('vuelve a admitir llamadas cuando la hora se cumplió', () => {
    const clock = fakeClock();
    const budget = new SmartoltHourlyBudget(1, clock);
    budget.consume('/api/onu/get_event_stream');

    clock.sleep(3_600_000);

    expect(() => budget.consume('/api/onu/get_event_stream')).not.toThrow();
    expect(budget.used).toBe(1);
  });
});
