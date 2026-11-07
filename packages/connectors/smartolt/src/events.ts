/**
 * El stream de eventos de SmartOLT (SSE), S3.
 *
 * La API de octubre 2026 no entrega los eventos directamente: primero hay que
 * pedir una URL con `GET /api/onu/get_event_stream?events=…`, que vence a los
 * 15 minutos y se puede pedir 60 veces por hora. Después se abre esa URL con un
 * cliente SSE y los eventos llegan como frames:
 *
 *     id: 42
 *     event: onu.status_changed
 *     data: {"type": "...", "timestamp": "...", "data": {"onus": [...]}}
 *
 * El stream se cierra solo, más o menos a la hora. Cuando eso pasa hay que
 * volver a pedir la URL y mandar el último `id` en `Last-Event-ID`: el
 * proveedor reenvía lo que nos perdimos. Además hay tres eventos de control:
 * `resync` (perdimos eventos: recargar el estado actual), `expired` (la URL
 * venció: pedir otra) y `disabled` (la API key se deshabilitó o cambió: el
 * stream no vuelve). Un `: ping` cada 25 segundos mantiene viva la conexión y,
 * para nosotros, es la prueba de que el stream sigue ahí.
 *
 * Lo que este módulo **no** hace: hablar con la base ni decidir qué se guarda.
 * Devuelve resultados tipados y el dueño del loop decide. Tampoco loguea: el
 * mensaje de cada error está escrito para poder viajar a un log sin arrastrar
 * el token del stream ni el `X-Token`.
 */
import { NMS_REQUEST_TIMEOUT_MS, UnsafeNmsUrlError, assertSafeNmsRequestUrl } from '@ftth-copilot/connectors-core';
import { SmartoltEventStreamError, SmartoltRateLimitError } from './errors';
import {
  SmartoltHourlyBudget,
  SmartoltRateGovernor,
  readRateLimitBody,
  readRetryAfterSeconds,
  resolveSmartoltRateLimitConfig,
  type SmartoltRateLimitOverrides,
} from './rate-limit';
import {
  getAccountHourlyBudget,
  getAccountRateGovernor,
  smartoltAccountKey,
} from './rate-limit-registry';
import {
  EVENT_STREAM_ENDPOINT,
  SMARTOLT_EVENT_TYPES,
  parseEventStreamResponse,
  parseSmartoltEventData,
  type SmartoltEventBatch,
  type SmartoltEventType,
} from './schemas';

/** Cuántas veces por hora se puede pedir la URL del stream. */
export const DEFAULT_EVENT_STREAM_ENDPOINT_PER_HOUR = 60;

/** Cuántos streams abiertos admite la cuenta (tope del proveedor). */
export const DEFAULT_EVENT_STREAM_MAX_STREAMS = 15;

/** La primera espera después de una falla, en milisegundos. */
export const DEFAULT_EVENT_BACKOFF_INITIAL_MS = 1_000;

/** La espera máxima entre reintentos, en milisegundos. */
export const DEFAULT_EVENT_BACKOFF_MAX_MS = 60_000;

/** Un entero positivo del entorno, o el default. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Si el consumidor pidió cortar. La llamada evita el estrechamiento del tipo. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** El mensaje de un fallo, sea lo que sea que se tiró. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Una espera que se corta si el consumidor aborta.
 *
 * El reloj inyectable se respeta (sigue siendo el que cuenta los milisegundos),
 * pero la espera se resuelve en el momento del aborto: apagar el worker no
 * puede quedarse colgado hasta `SMARTOLT_EVENT_BACKOFF_MAX_MS` (60 s).
 */
async function sleepUnlessAborted(
  clock: { sleep: (ms: number) => Promise<void> },
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal === undefined) {
    await clock.sleep(ms);
    return;
  }
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', done);
      resolve();
    };
    signal.addEventListener('abort', done, { once: true });
    void clock.sleep(ms).then(done, done);
  });
}

/**
 * Un `AbortSignal` que se dispara con cualquiera de los dos.
 *
 * El timeout de la petición sigue acotando el pedido; el signal del consumidor
 * le agrega el apagado. `AbortSignal.any` es de Node 20.3 y el repo exige
 * Node 22, así que está siempre.
 */
function combineSignals(timeoutSignal: AbortSignal, signal: AbortSignal | undefined): AbortSignal {
  if (signal === undefined) return timeoutSignal;
  return AbortSignal.any([timeoutSignal, signal]);
}

/** Un frame SSE ya completo. */
export interface SseFrame {
  /** `id` del frame, si el servidor lo mandó. */
  id?: string;
  /** `event`: el tipo de evento. */
  event?: string;
  /** `data`: el cuerpo, con las líneas unidas por `\n`. */
  data: string;
}

/** Lo que sale de un trozo del stream: un frame o un comentario. */
export type SseItem =
  | { kind: 'frame'; frame: SseFrame }
  | { kind: 'comment'; comment: string };

/**
 * El parser incremental de SSE.
 *
 * `feed` recibe los trozos tal como llegan (un frame puede venir partido en
 * dos, o tres) y devuelve los frames completos. Sigue el formato del estándar:
 * `campo: valor`, `:` para comentarios, línea en blanco para cerrar el frame y
 * las líneas `data:` unidas con `\n`.
 *
 * Una diferencia deliberada con el estándar: un frame con `event` y sin `data`
 * se entrega igual. Los eventos de control del proveedor (`resync`, `expired`,
 * `disabled`) son el mensaje, y descartarlos por no traer cuerpo dejaría al
 * conector ciego justo cuando tiene que reaccionar.
 */
export class SmartoltSseParser {
  private buffer = '';
  private pendingId: string | undefined;
  private hasId = false;
  private pendingEvent: string | undefined;
  private dataLines: string[] = [];

  /** Procesa un trozo del stream y devuelve lo que quedó completo. */
  feed(chunk: string): SseItem[] {
    this.buffer += chunk;
    const items: SseItem[] = [];
    for (;;) {
      const lineBreak = findLineBreak(this.buffer);
      if (lineBreak === null) break;
      const line = this.buffer.slice(0, lineBreak.index);
      this.buffer = this.buffer.slice(lineBreak.index + lineBreak.length);
      const item = this.consumeLine(line);
      if (item !== null) items.push(item);
    }
    return items;
  }

  private consumeLine(line: string): SseItem | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return { kind: 'comment', comment: line.slice(1).trim() };

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'id':
        this.pendingId = value;
        this.hasId = true;
        break;
      case 'event':
        this.pendingEvent = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      default:
        // `retry` y cualquier campo que no usemos se ignoran.
        break;
    }
    return null;
  }

  private dispatch(): SseItem | null {
    const data = this.dataLines.join('\n');
    const event = this.pendingEvent;
    const hasId = this.hasId;
    const id = this.pendingId;

    this.dataLines = [];
    this.pendingEvent = undefined;
    this.hasId = false;
    this.pendingId = undefined;

    if (data === '' && event === undefined && !hasId) return null;

    return {
      kind: 'frame',
      frame: {
        data,
        ...(hasId ? { id: id ?? '' } : {}),
        ...(event === undefined ? {} : { event }),
      },
    };
  }
}

/**
 * La posición del fin de línea en el buffer, o `null` si todavía no hay una
 * completa. Un `\r` al final puede ser la mitad de un `\r\n`: se espera.
 */
function findLineBreak(buffer: string): { index: number; length: number } | null {
  for (let index = 0; index < buffer.length; index++) {
    const char = buffer[index];
    if (char === '\n') return { index, length: 1 };
    if (char === '\r') {
      if (index === buffer.length - 1) return null;
      return { index, length: buffer[index + 1] === '\n' ? 2 : 1 };
    }
  }
  return null;
}

/**
 * Valida que la URL del stream sea del mismo host que la API.
 *
 * El proveedor entrega la URL con su propio token en el query, así que la
 * política SSRF de URL base no se puede aplicar tal cual (rechaza query y sólo
 * admite el puerto 443, y el stream viaja por 8443). La regla equivalente y más
 * fuerte es: **mismo host que la URL base que el operador ya configuró y que ya
 * pasó la política**. Si el proveedor mudara el stream a otro host, se habilita
 * con `SMARTOLT_EVENT_STREAM_ALLOWED_HOSTS`.
 */
export function assertStreamUrlBelongsToBase(
  rawUrl: string,
  apiBaseUrl: string,
  options: { env?: NodeJS.ProcessEnv; allowedHosts?: readonly string[] } = {},
): URL {
  const env = options.env ?? process.env;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeNmsUrlError('La URL del stream de eventos no es válida.');
  }

  const allowHttp = env['NMS_ALLOW_HTTP'] === 'true';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new UnsafeNmsUrlError('La URL del stream de eventos debe usar HTTPS.');
  }
  if (url.username || url.password) {
    throw new UnsafeNmsUrlError('La URL del stream de eventos no puede incluir credenciales.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(apiBaseUrl).hostname.toLowerCase());
  } catch {
    throw new UnsafeNmsUrlError('La URL base del conector no es válida.');
  }
  for (const host of options.allowedHosts ?? readAllowedHosts(env)) {
    allowed.add(host);
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UnsafeNmsUrlError('La URL del stream de eventos no puede apuntar a localhost.');
  }
  if (!allowed.has(hostname)) {
    throw new UnsafeNmsUrlError(
      'La URL del stream de eventos apunta a un host distinto del de la API del conector.',
    );
  }
  return url;
}

/** Los hosts extra que el operador habilitó para el stream. */
function readAllowedHosts(env: NodeJS.ProcessEnv): string[] {
  return (env['SMARTOLT_EVENT_STREAM_ALLOWED_HOSTS'] ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

/** Un resultado del stream, tipado: quien llama no parsea strings. */
export type SmartoltStreamOutcome =
  | { kind: 'event'; id: string | null; batch: SmartoltEventBatch }
  | { kind: 'resync'; id: string | null }
  | { kind: 'expired'; id: string | null }
  | { kind: 'disabled'; id: string | null }
  | { kind: 'ping' }
  | { kind: 'invalid'; id: string | null; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'fallback_polling'; status: 403 | 503; message: string };

/** Opciones del cliente del stream. */
export interface SmartoltEventStreamOptions {
  /** API key de la cuenta. Viaja sólo en el header `X-Token` de la API. */
  apiKey: string;
  /** URL base de la API. También delimita el host permitido del stream. */
  apiBaseUrl: string;
  /** Tipos a pedir. Default: todos los que publica la especificación. */
  events?: readonly SmartoltEventType[];
  /** `fetch` inyectable: los tests no abren sockets. */
  fetchImpl?: typeof fetch;
  /** Fuente de entorno para el presupuesto y el backoff. */
  env?: NodeJS.ProcessEnv;
  /** Pisa el presupuesto de la cuenta. */
  rateLimit?: SmartoltRateLimitOverrides;
  /** Comparte este guardia en vez del de la cuenta. */
  governor?: SmartoltRateGovernor;
  /** Reloj inyectable. Con reloj propio, el guardia y el presupuesto son locales. */
  now?: () => number;
  /** `sleep` inyectable. */
  sleep?: (ms: number) => Promise<void>;
  /** Primera espera tras una falla. Default `SMARTOLT_EVENT_BACKOFF_INITIAL_MS` (1000). */
  initialBackoffMs?: number;
  /** Espera máxima entre reintentos. Default `SMARTOLT_EVENT_BACKOFF_MAX_MS` (60000). */
  maxBackoffMs?: number;
  /** Tope de pedidos de URL por hora. Default `SMARTOLT_EVENT_STREAM_ENDPOINT_PER_HOUR` (60). */
  endpointPerHour?: number;
  /** Hosts extra admitidos para la URL del stream. */
  allowedStreamHosts?: readonly string[];
}

/**
 * El cliente del stream de eventos de una cuenta.
 *
 * `events()` es un generador que no termina solo: se reconecta, respeta el
 * presupuesto del endpoint y entrega cada evento ya validado. Termina cuando el
 * proveedor deshabilita el stream (`disabled`), cuando el stream no está
 * disponible y hay que caer al poll (`fallback_polling`), cuando el pedido es
 * inválido (`400`) o cuando quien lo consume corta la iteración.
 */
export class SmartoltEventStream {
  private readonly apiKey: string;
  private readonly apiBaseUrl: string;
  private readonly eventTypes: readonly SmartoltEventType[];
  private readonly fetchImpl: typeof fetch;
  private readonly skipDnsValidation: boolean;
  private readonly env: NodeJS.ProcessEnv;
  private readonly governor: SmartoltRateGovernor;
  private readonly endpointBudget: SmartoltHourlyBudget;
  private readonly clock: { now: () => number; sleep: (ms: number) => Promise<void> };
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly allowedStreamHosts?: readonly string[];

  constructor(options: SmartoltEventStreamOptions) {
    this.apiKey = options.apiKey;
    this.apiBaseUrl = options.apiBaseUrl;
    this.eventTypes =
      options.events !== undefined && options.events.length > 0
        ? [...options.events]
        : [...SMARTOLT_EVENT_TYPES];
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.skipDnsValidation = options.fetchImpl !== undefined;

    this.clock = {
      now: options.now ?? (() => Date.now()),
      sleep:
        options.sleep ??
        ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    };

    const deterministicClock = options.now !== undefined || options.sleep !== undefined;
    const config = resolveSmartoltRateLimitConfig(options.env, options.rateLimit);
    const accountKey = smartoltAccountKey({
      apiBaseUrl: options.apiBaseUrl,
      apiKey: options.apiKey,
    });

    this.governor =
      options.governor ??
      (deterministicClock
        ? new SmartoltRateGovernor(config, this.clock)
        : getAccountRateGovernor(accountKey, config, this.clock));

    const endpointPerHour =
      options.endpointPerHour ??
      positiveInt(
        options.env?.['SMARTOLT_EVENT_STREAM_ENDPOINT_PER_HOUR'],
        DEFAULT_EVENT_STREAM_ENDPOINT_PER_HOUR,
      );
    this.endpointBudget = deterministicClock
      ? new SmartoltHourlyBudget(endpointPerHour, this.clock)
      : getAccountHourlyBudget(accountKey, endpointPerHour, this.clock);

    this.initialBackoffMs =
      options.initialBackoffMs ??
      positiveInt(
        options.env?.['SMARTOLT_EVENT_BACKOFF_INITIAL_MS'],
        DEFAULT_EVENT_BACKOFF_INITIAL_MS,
      );
    this.maxBackoffMs =
      options.maxBackoffMs ??
      positiveInt(
        options.env?.['SMARTOLT_EVENT_BACKOFF_MAX_MS'],
        DEFAULT_EVENT_BACKOFF_MAX_MS,
      );
    this.allowedStreamHosts = options.allowedStreamHosts;
  }

  /**
   * Pide la URL del stream, gastando el presupuesto del endpoint (60/hora).
   *
   * `Last-Event-ID` viaja también acá: la especificación pide mandar el último
   * `id` al volver a pedir la URL, para recibir lo que se perdió. El error de un
   * 400/403/503 es tipado; el mensaje no incluye el token del stream.
   *
   * `signal` es el del consumidor: el pedido se corta en el apagado, sin esperar
   * al timeout de la petición.
   */
  async requestStreamUrl(
    lastEventId?: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const query = new URLSearchParams({ events: this.eventTypes.join(',') });
    const requestUrl = await assertSafeNmsRequestUrl(
      this.apiBaseUrl,
      `${EVENT_STREAM_ENDPOINT}?${query.toString()}`,
      { resolveDns: !this.skipDnsValidation },
    );

    await this.governor.beforeRequest(EVENT_STREAM_ENDPOINT);
    this.endpointBudget.consume(EVENT_STREAM_ENDPOINT);

    const headers: Record<string, string> = {
      'X-Token': this.apiKey,
      Accept: 'application/json',
    };
    if (lastEventId !== undefined && lastEventId.length > 0) {
      headers['Last-Event-ID'] = lastEventId;
    }

    const response = await this.fetchImpl(requestUrl, {
      headers,
      redirect: 'error',
      signal: combineSignals(AbortSignal.timeout(NMS_REQUEST_TIMEOUT_MS), signal),
    });
    this.governor.observeResponse(response.headers, EVENT_STREAM_ENDPOINT);

    if (response.status === 429) {
      const retryAfterSeconds =
        readRetryAfterSeconds(response.headers) ??
        readRateLimitBody(await readJsonOrUndefined(response)).retryAfterSeconds;
      throw new SmartoltRateLimitError(
        `SmartOLT limitó el pedido de la URL del stream (${EVENT_STREAM_ENDPOINT})` +
          (retryAfterSeconds === undefined ? '.' : ` y pidió esperar ${retryAfterSeconds}s.`),
        {
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
          endpoint: EVENT_STREAM_ENDPOINT,
          attempts: 0,
        },
      );
    }

    if (response.status === 400) {
      throw new SmartoltEventStreamError(
        'SmartOLT rechazó la lista de eventos del stream (HTTP 400): ' +
          'hay un tipo de evento que la API no conoce.',
        { status: 400, reason: 'unknown_event_type' },
      );
    }
    if (response.status === 403) {
      throw new SmartoltEventStreamError(
        'SmartOLT no autoriza el stream de eventos para esta API key (HTTP 403): ' +
          'la clave no es una clave de cliente.',
        { status: 403, reason: 'forbidden' },
      );
    }
    if (response.status === 503) {
      throw new SmartoltEventStreamError(
        'SmartOLT no ofrece el stream de eventos ahora mismo (HTTP 503): ' +
          'hay que seguir con el poll programado hasta que vuelva.',
        { status: 503, reason: 'unavailable' },
      );
    }
    if (!response.ok) {
      throw new SmartoltEventStreamError(
        `SmartOLT API ${response.status}: ${response.statusText} (${EVENT_STREAM_ENDPOINT})`,
        { status: response.status, reason: 'unavailable' },
      );
    }

    const parsed = parseEventStreamResponse(
      await readJsonOrUndefined(response),
      EVENT_STREAM_ENDPOINT,
    );
    if (!parsed.status) {
      throw new SmartoltEventStreamError(
        `SmartOLT devolvió status: false al pedir la URL del stream (${EVENT_STREAM_ENDPOINT}).`,
        { status: response.status, reason: 'unavailable' },
      );
    }

    const url = assertStreamUrlBelongsToBase(parsed.url, this.apiBaseUrl, {
      env: this.env,
      ...(this.allowedStreamHosts === undefined
        ? {}
        : { allowedHosts: this.allowedStreamHosts }),
    });

    return { url: url.toString(), expiresInSeconds: parsed.expiresInSeconds };
  }

  /**
   * El stream, como generador de resultados tipados.
   *
   * Abre la URL, entrega lo que llega y se reconecta cuando el stream se
   * cierra. Los eventos de control se entregan como tales; el 503 y el 403 se
   * entregan como `fallback_polling` y terminan el generador, que es lo que el
   * worker necesita para dejar el trabajo al poll programado sin reintentar
   * contra un proveedor que ya dijo que no.
   */
  async *events(options: { signal?: AbortSignal } = {}): AsyncGenerator<SmartoltStreamOutcome> {
    const signal = options.signal;
    let lastEventId: string | undefined;
    let target: { url: string; expiresAtMs: number } | undefined;
    let backoffMs = this.initialBackoffMs;

    for (;;) {
      if (isAborted(signal)) return;
      if (target !== undefined && this.clock.now() >= target.expiresAtMs) target = undefined;

      if (target === undefined) {
        try {
          const acquired = await this.requestStreamUrl(lastEventId, signal);
          target = {
            url: acquired.url,
            expiresAtMs: this.clock.now() + acquired.expiresInSeconds * 1_000,
          };
        } catch (error) {
          // El apagado no es una falla del proveedor: el pedido de la URL se
          // cortó porque el consumidor se fue.
          if (isAborted(signal)) return;
          const streamError = error instanceof SmartoltEventStreamError ? error : undefined;
          if (streamError !== undefined && (streamError.status === 403 || streamError.status === 503)) {
            const status = streamError.status as 403 | 503;
            yield { kind: 'fallback_polling', status, message: streamError.message };
            return;
          }
          // El presupuesto agotado y un pedido inválido no se resuelven
          // reintentando: quien orquesta decide cuándo volver.
          if (error instanceof SmartoltRateLimitError) throw error;
          if (streamError !== undefined && streamError.status === 400) throw streamError;

          yield { kind: 'error', message: errorMessage(error) };
          await sleepUnlessAborted(this.clock, backoffMs, signal);
          if (isAborted(signal)) return;
          backoffMs = Math.min(backoffMs * 2, this.maxBackoffMs);
          continue;
        }
      }

      let endedWithExpired = false;
      try {
        for await (const item of this.readStream(target.url, lastEventId, signal)) {
          if (isAborted(signal)) return;
          backoffMs = this.initialBackoffMs;

          if (item.kind === 'comment') {
            yield { kind: 'ping' };
            continue;
          }

          const frame = item.frame;
          const id = frame.id ?? null;
          if (frame.id !== undefined) lastEventId = frame.id;

          if (frame.event === 'resync' || frame.event === 'expired' || frame.event === 'disabled') {
            yield { kind: frame.event, id };
            if (frame.event === 'disabled') return;
            if (frame.event === 'expired') {
              endedWithExpired = true;
              break;
            }
            continue;
          }

          if (frame.data.length === 0) continue;

          try {
            yield { kind: 'event', id, batch: parseSmartoltEventData(frame.data) };
          } catch (error) {
            yield { kind: 'invalid', id, message: errorMessage(error) };
          }
        }
      } catch (error) {
        if (isAborted(signal)) return;
        const streamError = error instanceof SmartoltEventStreamError ? error : undefined;
        if (streamError !== undefined && (streamError.status === 403 || streamError.status === 503)) {
          const status = streamError.status as 403 | 503;
          yield { kind: 'fallback_polling', status, message: streamError.message };
          return;
        }
        yield { kind: 'error', message: errorMessage(error) };
        await sleepUnlessAborted(this.clock, backoffMs, signal);
        if (isAborted(signal)) return;
        backoffMs = Math.min(backoffMs * 2, this.maxBackoffMs);
        target = undefined;
        continue;
      }

      // El stream se cerró (a la hora, o porque venció la URL). Se pide otra
      // URL y se reconecta con el último id.
      target = undefined;
      if (!endedWithExpired) {
        await sleepUnlessAborted(this.clock, backoffMs, signal);
        if (isAborted(signal)) return;
        backoffMs = Math.min(backoffMs * 2, this.maxBackoffMs);
      } else {
        backoffMs = this.initialBackoffMs;
      }
    }
  }

  /**
   * Lee un stream ya abierto y entrega frames y comentarios.
   *
   * La URL del stream lleva su token en el query; ningún error de acá lo
   * incluye (sólo el estado HTTP).
   */
  private async *readStream(
    url: string,
    lastEventId: string | undefined,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<SseItem> {
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (lastEventId !== undefined && lastEventId.length > 0) {
      headers['Last-Event-ID'] = lastEventId;
    }

    const response = await this.fetchImpl(url, {
      headers,
      redirect: 'error',
      ...(signal === undefined ? {} : { signal }),
    });

    if (response.status === 403 || response.status === 503) {
      throw new SmartoltEventStreamError(
        `SmartOLT respondió ${response.status} al abrir el stream de eventos.`,
        { status: response.status, reason: response.status === 403 ? 'forbidden' : 'unavailable' },
      );
    }
    if (!response.ok) {
      throw new SmartoltEventStreamError(
        `SmartOLT respondió ${response.status} al abrir el stream de eventos.`,
        { status: response.status, reason: 'unavailable' },
      );
    }
    if (response.body === null) {
      throw new SmartoltEventStreamError('El stream de eventos llegó sin cuerpo.', {
        status: response.status,
        reason: 'shape',
      });
    }

    const parser = new SmartoltSseParser();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const body = response.body;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const item of parser.feed(decoder.decode(value, { stream: true }))) yield item;
      }
      for (const item of parser.feed(decoder.decode())) yield item;
    } finally {
      // El lock se suelta para poder cancelar el cuerpo, y el cuerpo se
      // cancela SIEMPRE: al salir por `expired`, por un error de lectura o
      // porque el consumidor cortó la iteración. Sin esto, cada reconexión
      // deja el socket del stream anterior abierto (la URL vence cada 15
      // minutos y el stream cierra a la hora: una fuga por reconexión).
      reader.releaseLock();
      try {
        await body.cancel();
      } catch {
        // Un cuerpo ya cerrado (o un fallo del cancel) no cambia el resultado:
        // el stream anterior se suelta igual.
      }
    }
  }
}

/** Lee el cuerpo JSON de una respuesta, o `undefined` si no es JSON. */
async function readJsonOrUndefined(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}
