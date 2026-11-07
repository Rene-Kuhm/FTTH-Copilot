/**
 * El loop de eventos de SmartOLT en el worker (S3 + S5).
 *
 * Mientras el poll programado pregunta cada quince minutos, el stream avisa en
 * el momento: una ONU que se cae, una señal que baja dos dB, un PON que se
 * corta. Este módulo es el pegamento entre el cliente del stream (que vive en
 * `@ftth-copilot/connectors-smartolt`) y la persistencia que el poll ya usa.
 *
 * Tres decisiones que conviene tener a mano:
 *
 *   1. **Un loop por conexión SmartOLT conectada.** Cada conexión tiene su API
 *      key y su URL base; compartir un stream entre conexiones no se puede. El
 *      proveedor admite hasta 15 streams abiertos por cuenta, y el loop respeta
 *      ese tope (`SMARTOLT_EVENT_MAX_STREAMS`). La señal de vida también es por
 *      conexión: un watchdog corta el stream que pasó `SMARTOLT_EVENT_LIVENESS_MS`
 *      sin un solo frame y lo reconecta con backoff acotado, y la salud publica
 *      el plazo de la conexión más próxima a vencer — el ping de una conexión
 *      sana no tapa a la que se quedó callada.
 *   2. **Se guarda por el mismo camino que el poll.** Los eventos se traducen a
 *      `MetricPoint` (`onuEventPoints`) y se persisten con `persistSamples` de
 *      `@ftth-copilot/analytics`, la misma función que usa `runPollCycle`. Cada
 *      punto lleva el `tenantId` y el `connectionId` de la conexión: el
 *      aislamiento por tenant no depende de nada más.
 *   3. **Apagado por default.** `SMARTOLT_EVENTS_ENABLED=true` es lo único que
 *      lo enciende, así que una instalación que no lo pidió se comporta igual
 *      que antes. Cuando está apagado no se registra en la salud: un loop que
 *      no existe no puede figurar como colgado.
 *
 * Lo que el loop **no** hace: detección. Igual que el tick de FEC, escribe las
 * muestras y deja que el trabajo de detección programado las lea.
 */
import { persistSamples } from '@ftth-copilot/analytics';
import { decryptApiKey, prisma } from '@ftth-copilot/db';
import { createLogger } from '@ftth-copilot/shared';
import {
  DEFAULT_EVENT_BACKOFF_INITIAL_MS,
  DEFAULT_EVENT_BACKOFF_MAX_MS,
  DEFAULT_EVENT_STREAM_MAX_STREAMS,
  SmartoltEventStream,
  isSmartoltEventType,
  type SmartoltEventType,
  type SmartoltStreamOutcome,
} from '@ftth-copilot/connectors-smartolt';
import type { MetricPoint, SampleMeta } from '@ftth-copilot/analytics';
import { recordDegradedOnu } from './degraded-onus';
import {
  DEFAULT_DEGRADED_RX_THRESHOLD_DBM,
  onuEventPoints,
} from './event-points';
import {
  markExpected,
  markNotExpected,
  recordError as recordSchedulerError,
  recordSuccess as recordSchedulerSuccess,
  setNextRun,
} from './health';

const log = createLogger({ name: 'smartolt-events' });

/** La bandera que enciende el loop. Sin ella no hay stream. */
export const SMARTOLT_EVENTS_FLAG = 'SMARTOLT_EVENTS_ENABLED';

/**
 * Cuánto puede pasar sin noticias de UNA conexión antes de darla por muerta.
 *
 * El proveedor manda un `: ping` cada 25 segundos, así que dos minutos sin un
 * solo frame es un stream muerto, no un stream tranquilo. Al vencer, el loop
 * corta ese stream y lo vuelve a abrir: un socket medio abierto no se arregla
 * solo, y esperar el cierre del proveedor puede tardar una hora.
 */
export const DEFAULT_EVENT_LIVENESS_MS = 120_000;

/**
 * El tope de streams abiertos por cuenta que publica el proveedor.
 *
 * Es el mismo valor que usa el cliente del conector: un solo número para toda
 * la plataforma.
 */
export const DEFAULT_EVENT_MAX_STREAMS_PER_ACCOUNT = DEFAULT_EVENT_STREAM_MAX_STREAMS;

/** El nombre del loop en el registro de salud. */
export const SMARTOLT_EVENTS_HEALTH_NAME = 'smartolt-events' as const;

/** Una conexión tal como la guarda la base. */
export interface SmartoltEventConnectionRecord {
  id: string;
  tenantId: string;
  provider: string;
  baseUrl: string | null;
  encryptedKey: string;
}

/** Lo que necesita el cliente del stream para conectarse. */
export interface SmartoltEventCredentials {
  connectionId: string;
  tenantId: string;
  baseUrl: string;
  apiKey: string;
}

/**
 * La parte del cliente del stream que el loop usa.
 *
 * Es una interfaz propia para que los tests puedan entregar un guion sin abrir
 * sockets ni esperar una hora.
 */
export interface SmartoltEventStreamLike {
  events(options?: { signal?: AbortSignal }): AsyncIterable<SmartoltStreamOutcome>;
}

/** Cómo se construye el stream de una conexión. */
export type SmartoltEventStreamFactory = (
  credentials: SmartoltEventCredentials,
  env: NodeJS.ProcessEnv,
) => SmartoltEventStreamLike;

/**
 * Los timers del watchdog de liveness.
 *
 * Inyectables para que la prueba no espere dos minutos a que un socket medio
 * abierto se dé por muerto.
 */
export interface SmartoltEventLoopTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Los timers reales, con el watchdog desenganchado del event loop. */
const defaultTimers: SmartoltEventLoopTimers = {
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    // El watchdog no puede ser la razón por la que el worker no sale.
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** Lo que se puede inyectar (los tests no tocan la base ni la red). */
export interface SmartoltEventLoopOptions {
  /** Entorno del que salen la bandera y los topes. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Lee las conexiones SmartOLT conectadas. Default: Prisma. */
  listConnections?: () => Promise<SmartoltEventConnectionRecord[]>;
  /** Descifra la API key. Default: `decryptApiKey` de `db`. */
  decrypt?: (encryptedKey: string) => string;
  /** Persiste las muestras. Default: `persistSamples` de `analytics`. */
  persist?: (points: MetricPoint[]) => Promise<{ inserted: number }>;
  /** Construye el stream de una conexión. Default: `SmartoltEventStream`. */
  createStream?: SmartoltEventStreamFactory;
  /** Reloj inyectable. Default `Date.now`. */
  now?: () => number;
  /** Espera inyectable entre reconexiones. Default: `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Timers inyectables del watchdog de liveness. Default: los reales. */
  timers?: SmartoltEventLoopTimers;
}

/** El loop en marcha. */
export interface SmartoltEventLoopHandle {
  /** Si el loop está encendido (la bandera del entorno). */
  readonly enabled: boolean;
  /** Cuántos streams se abrieron. */
  readonly connections: number;
  /** Resuelve cuando el arranque terminó: conexiones listadas y loops lanzados. */
  readonly ready: Promise<void>;
  /** Espera a que los loops terminen (los de los tests terminan; los reales no). */
  settled(): Promise<void>;
  /** Corta todos los streams y espera a que los loops salgan. */
  stop(): Promise<void>;
}

/** Un entero positivo del entorno, o el default. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Un decimal del entorno (el umbral es negativo), o el default. */
function floatOr(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat((raw ?? '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** El mensaje de un fallo. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** La cuenta de una URL base, para contar los streams por cuenta. */
function accountOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return baseUrl.trim().toLowerCase();
  }
}

/** Los tipos de evento que pide el stream, del entorno o todos. */
function readEventTypes(env: NodeJS.ProcessEnv): SmartoltEventType[] | undefined {
  const raw = env['SMARTOLT_EVENT_TYPES'];
  if (raw === undefined || raw.trim() === '') return undefined;
  const types = raw
    .split(',')
    .map((type) => type.trim())
    .filter((type) => type.length > 0);
  const known = types.filter(isSmartoltEventType);
  return known.length > 0 ? known : undefined;
}

/** El stream real de una conexión. */
function createDefaultStream(
  credentials: SmartoltEventCredentials,
  env: NodeJS.ProcessEnv,
): SmartoltEventStreamLike {
  const types = readEventTypes(env);
  return new SmartoltEventStream({
    apiKey: credentials.apiKey,
    apiBaseUrl: credentials.baseUrl,
    env,
    ...(types === undefined ? {} : { events: types }),
  });
}

/** Las conexiones que el loop tiene que atender. */
async function listSmartoltConnections(): Promise<SmartoltEventConnectionRecord[]> {
  const connections = await prisma.nmsConnection.findMany({
    where: { status: 'connected', provider: 'SMARTOLT' },
  });
  return connections.map((connection) => ({
    id: connection.id,
    tenantId: connection.tenantId,
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    encryptedKey: connection.encryptedKey,
  }));
}

/**
 * Arranca un loop de eventos por conexión SmartOLT.
 *
 * Devuelve enseguida: listar las conexiones es asíncrono y el worker no puede
 * quedarse esperando (los sockets y el apagado dependen de que el arranque
 * siga). `ready` resuelve cuando los loops quedaron lanzados.
 */
export function startSmartoltEventStreams(
  options: SmartoltEventLoopOptions = {},
): SmartoltEventLoopHandle {
  const env = options.env ?? process.env;

  if (env[SMARTOLT_EVENTS_FLAG] !== 'true') {
    // Apagado: ni conexiones, ni salud, ni stream. La producción se comporta
    // igual que antes de que este loop existiera.
    return {
      enabled: false,
      connections: 0,
      ready: Promise.resolve(),
      settled: async () => {},
      stop: async () => {},
    };
  }

  const now = options.now ?? (() => Date.now());
  const livenessMs = positiveInt(env['SMARTOLT_EVENT_LIVENESS_MS'], DEFAULT_EVENT_LIVENESS_MS);
  const maxStreams = positiveInt(
    env['SMARTOLT_EVENT_MAX_STREAMS'],
    DEFAULT_EVENT_MAX_STREAMS_PER_ACCOUNT,
  );
  const initialBackoffMs = positiveInt(
    env['SMARTOLT_EVENT_BACKOFF_INITIAL_MS'],
    DEFAULT_EVENT_BACKOFF_INITIAL_MS,
  );
  const maxBackoffMs = positiveInt(
    env['SMARTOLT_EVENT_BACKOFF_MAX_MS'],
    DEFAULT_EVENT_BACKOFF_MAX_MS,
  );
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const timers = options.timers ?? defaultTimers;
  const thresholdDbm = floatOr(
    env['FEC_DEGRADED_RX_THRESHOLD_DBM'],
    DEFAULT_DEGRADED_RX_THRESHOLD_DBM,
  );
  const listConnections = options.listConnections ?? listSmartoltConnections;
  const decrypt = options.decrypt ?? decryptApiKey;
  const persist = options.persist ?? persistSamples;
  const createStream = options.createStream ?? createDefaultStream;

  const controllers = new Set<AbortController>();
  const running = new Set<Promise<void>>();
  let opened = 0;
  let stopped = false;

  /**
   * Las conexiones con un stream abierto y el plazo de cada una, en epoch ms.
   *
   * La liveness es de cada conexión, no del loop: el `: ping` de una conexión
   * sana no puede tapar a la que dejó de mandar frames.
   */
  const liveness = new Map<string, number>();

  /**
   * Las conexiones que terminaron con un motivo que el operador tiene que ver
   * (`disabled`, `fallback_polling`).
   *
   * La salud es una sola para todo el loop, así que un `: ping` de otra
   * conexión —que llama a `recordSuccess` y limpia el último error— taparía el
   * motivo. Se vuelve a publicar en cada refresco: la razón es del operador y
   * no se borra con la vida de las demás.
   */
  const terminalReasons = new Map<string, string>();

  const rememberTerminal = (connectionId: string, message: string): void => {
    terminalReasons.set(connectionId, message);
  };

  /**
   * Publica la salud del loop a partir de la liveness de sus conexiones.
   *
   * El plazo es el de la conexión más próxima a vencer. Sin conexiones vivas
   * no hay stream que vigilar: el loop queda **inactivo** —el estado que la
   * salud ya publica y que la web sabe dibujar— en vez de colgado para
   * siempre, que es lo que pasaba con la bandera encendida y cero conexiones
   * (o después de un `disabled`/`fallback_polling`, que son terminales).
   */
  const publishHealth = (): void => {
    if (terminalReasons.size > 0) {
      recordSchedulerError(
        SMARTOLT_EVENTS_HEALTH_NAME,
        [...terminalReasons.values()].join(' '),
        now(),
      );
    }
    if (liveness.size === 0) {
      markNotExpected(SMARTOLT_EVENTS_HEALTH_NAME);
      setNextRun(SMARTOLT_EVENTS_HEALTH_NAME, null);
      return;
    }
    let deadlineMs = Number.POSITIVE_INFINITY;
    for (const entry of liveness.values()) {
      if (entry < deadlineMs) deadlineMs = entry;
    }
    markExpected(SMARTOLT_EVENTS_HEALTH_NAME, { intervalMs: livenessMs, nextRunAt: deadlineMs });
  };

  /** Renueva el plazo de UNA conexión: hay una prueba de vida nueva. */
  const touch = (connectionId: string, nowMs: number): void => {
    liveness.set(connectionId, nowMs + livenessMs);
    publishHealth();
  };

  /** Saca una conexión de la liveness: terminó, o su loop se apagó. */
  const forget = (connectionId: string): void => {
    liveness.delete(connectionId);
    publishHealth();
  };

  // El apagado corta también la espera entre reintentos: un `stop()` no puede
  // quedarse esperando el backoff máximo.
  const stopController = new AbortController();
  const sleepOrStop = async (ms: number): Promise<void> => {
    if (stopController.signal.aborted) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        stopController.signal.removeEventListener('abort', done);
        resolve();
      };
      stopController.signal.addEventListener('abort', done, { once: true });
      void sleep(ms).then(done, done);
    });
  };

  async function runConnection(
    connection: SmartoltEventConnectionRecord,
    credentials: SmartoltEventCredentials,
  ): Promise<void> {
    const meta: SampleMeta = { tenantId: connection.tenantId, connectionId: connection.id };
    const scope = { tenantId: connection.tenantId, connectionId: connection.id };

    let stream: SmartoltEventStreamLike;
    try {
      stream = createStream(credentials, env);
    } catch (error) {
      recordSchedulerError(
        SMARTOLT_EVENTS_HEALTH_NAME,
        `no se pudo abrir el stream de la conexión ${connection.id}: ${errorMessage(error)}`,
      );
      return;
    }

    let backoffMs = initialBackoffMs;

    // Un stream que se corta por liveness se reconecta con backoff acotado; un
    // final tipado (`disabled`, `fallback_polling`) o el apagado terminan el
    // loop de la conexión.
    for (;;) {
      if (stopped) {
        forget(connection.id);
        return;
      }

      const controller = new AbortController();
      controllers.add(controller);
      let watchdog: unknown;

      const disarmWatchdog = (): void => {
        if (watchdog === undefined) return;
        timers.clearTimeout(watchdog);
        watchdog = undefined;
      };

      /**
       * Arma el plazo de la liveness de esta conexión.
       *
       * Cuando vence, el socket está medio abierto: no llegó ni un frame ni el
       * `: ping` que el proveedor manda cada 25 segundos. Se corta el stream y
       * el loop lo vuelve a abrir.
       */
      const armWatchdog = (): void => {
        disarmWatchdog();
        watchdog = timers.setTimeout(() => {
          watchdog = undefined;
          log.warn('no frames within the liveness window: the stream is half open, reconnecting', {
            tenantId: connection.tenantId,
            connectionId: connection.id,
            livenessMs,
          });
          controller.abort();
        }, livenessMs);
      };

      touch(connection.id, now());
      armWatchdog();

      let terminal = false;
      try {
        for await (const outcome of stream.events({ signal: controller.signal })) {
          if (stopped || controller.signal.aborted) break;
          const nowMs = now();

          switch (outcome.kind) {
            case 'event': {
              const mapped = onuEventPoints(meta, outcome.batch, {
                sampledAt: new Date(nowMs).toISOString(),
                nowMs,
                thresholdDbm,
              });
              for (const signal of mapped.degraded) recordDegradedOnu(scope, signal);

              let inserted = 0;
              if (mapped.points.length > 0) {
                // El watchdog mide el socket, no la persistencia: mientras se
                // guardan las muestras no hay nada que leer del stream.
                disarmWatchdog();
                try {
                  inserted = (await persist(mapped.points)).inserted;
                } catch (error) {
                  recordSchedulerError(
                    SMARTOLT_EVENTS_HEALTH_NAME,
                    `no se pudieron guardar las muestras del evento: ${errorMessage(error)}`,
                  );
                  log.error('could not persist event samples', {
                    tenantId: connection.tenantId,
                    connectionId: connection.id,
                    type: outcome.batch.type,
                    error: errorMessage(error),
                  });
                }
              }

              log.info('event', {
                tenantId: connection.tenantId,
                connectionId: connection.id,
                type: outcome.batch.type,
                rows: outcome.batch.rows.length,
                persisted: inserted,
                degraded: mapped.degraded.length,
              });
              recordSchedulerSuccess(SMARTOLT_EVENTS_HEALTH_NAME, nowMs);
              touch(connection.id, nowMs);
              armWatchdog();
              break;
            }

            case 'ping':
              // El `: ping` no trae datos: es la prueba de que el stream vive.
              recordSchedulerSuccess(SMARTOLT_EVENTS_HEALTH_NAME, nowMs);
              touch(connection.id, nowMs);
              armWatchdog();
              break;

            case 'resync':
              // Perdimos eventos: el estado actual se recupera con el poll
              // programado, que ya corre. Se deja anotado para el operador.
              log.warn('resync: events were missed, the scheduled poll reloads the current data', {
                tenantId: connection.tenantId,
                connectionId: connection.id,
                lastEventId: outcome.id,
              });
              recordSchedulerSuccess(SMARTOLT_EVENTS_HEALTH_NAME, nowMs);
              touch(connection.id, nowMs);
              armWatchdog();
              break;

            case 'expired':
              // La URL venció: el cliente pide otra y se reconecta solo.
              log.info('stream url expired, reconnecting', {
                tenantId: connection.tenantId,
                connectionId: connection.id,
                lastEventId: outcome.id,
              });
              touch(connection.id, nowMs);
              armWatchdog();
              break;

            case 'invalid':
              // El cuerpo no parsea: se descarta el lote y se sigue. Insistir con
              // un cuerpo que no entendemos no arregla nada.
              log.warn('invalid event body', {
                tenantId: connection.tenantId,
                connectionId: connection.id,
                lastEventId: outcome.id,
                reason: outcome.message,
              });
              touch(connection.id, nowMs);
              armWatchdog();
              break;

            case 'error':
              // El cliente reintenta con su propio backoff: mientras espera no
              // hay socket que vigilar, así que el watchdog se apaga hasta el
              // próximo frame.
              log.warn('stream error', {
                tenantId: connection.tenantId,
                connectionId: connection.id,
                error: outcome.message,
              });
              recordSchedulerSuccess(SMARTOLT_EVENTS_HEALTH_NAME, nowMs);
              recordSchedulerError(SMARTOLT_EVENTS_HEALTH_NAME, outcome.message, nowMs);
              touch(connection.id, nowMs);
              disarmWatchdog();
              break;

            case 'disabled':
              log.error('the stream was disabled by SmartOLT: the API key was disabled or changed', {
                tenantId: connection.tenantId,
                connectionId: connection.id,
              });
              rememberTerminal(
                connection.id,
                `la API key de la conexión ${connection.id} fue deshabilitada o cambió: ` +
                  'hay que reconfigurarla y reiniciar el worker para volver a abrir el stream.',
              );
              terminal = true;
              break;

            case 'fallback_polling':
              log.warn('the event stream is not available: falling back to the scheduled poll', {
                tenantId: connection.tenantId,
                connectionId: connection.id,
                status: outcome.status,
              });
              rememberTerminal(
                connection.id,
                `el stream de eventos no está disponible (HTTP ${outcome.status}); ` +
                  'el poll programado sigue cubriendo la conexión.',
              );
              terminal = true;
              break;
          }

          if (terminal) break;
        }
      } catch (error) {
        if (!controller.signal.aborted && !stopped) {
          recordSchedulerError(
            SMARTOLT_EVENTS_HEALTH_NAME,
            `el stream de la conexión ${connection.id} falló: ${errorMessage(error)}`,
          );
          log.error('stream failed', {
            tenantId: connection.tenantId,
            connectionId: connection.id,
            error: errorMessage(error),
          });
        }
      } finally {
        disarmWatchdog();
        controllers.delete(controller);
      }

      if (terminal || stopped) {
        // Un final tipado o el apagado: la conexión sale de la liveness para
        // que su plazo no la reporte colgada, y el `lastError` dice por qué.
        log.info('stream ended', {
          tenantId: connection.tenantId,
          connectionId: connection.id,
        });
        forget(connection.id);
        return;
      }

      if (!controller.signal.aborted) {
        // El generador del cliente se cerró solo. El conector sólo termina así
        // después de un final tipado o de un aborto; si pasa igual, la
        // conexión se quedó sin stream y su plazo —que vence— lo dice.
        log.info('stream ended', {
          tenantId: connection.tenantId,
          connectionId: connection.id,
        });
        return;
      }

      // El watchdog la cortó: el socket estaba medio abierto. Se vuelve a abrir
      // con backoff acotado.
      await sleepOrStop(backoffMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
  }

  const ready = (async (): Promise<void> => {
    try {
      const connections = await listConnections();
      const perAccount = new Map<string, number>();

      for (const connection of connections) {
        if (stopped) return;
        if (connection.provider !== 'SMARTOLT') continue;
        const baseUrl = connection.baseUrl?.trim();
        if (baseUrl === undefined || baseUrl.length === 0) continue;

        const account = accountOf(baseUrl);
        const count = perAccount.get(account) ?? 0;
        if (count >= maxStreams) {
          log.warn('stream cap per account reached', {
            tenantId: connection.tenantId,
            connectionId: connection.id,
            maxStreams,
          });
          recordSchedulerError(
            SMARTOLT_EVENTS_HEALTH_NAME,
            `la cuenta ${account} ya tiene ${maxStreams} streams abiertos, ` +
              `que es el tope del proveedor; la conexión ${connection.id} sigue con el poll programado.`,
          );
          continue;
        }
        perAccount.set(account, count + 1);

        let apiKey: string;
        try {
          apiKey = decrypt(connection.encryptedKey);
        } catch (error) {
          log.error('could not decrypt the connector credentials', {
            tenantId: connection.tenantId,
            connectionId: connection.id,
            error: errorMessage(error),
          });
          recordSchedulerError(
            SMARTOLT_EVENTS_HEALTH_NAME,
            `no se pudo descifrar la credencial de la conexión ${connection.id}: ${errorMessage(error)}`,
          );
          continue;
        }

        opened += 1;

        const credentials: SmartoltEventCredentials = {
          connectionId: connection.id,
          tenantId: connection.tenantId,
          baseUrl,
          apiKey,
        };
        const promise = runConnection(connection, credentials)
          .catch((error: unknown) => {
            log.error('event loop failed', {
              tenantId: connection.tenantId,
              connectionId: connection.id,
              error: errorMessage(error),
            });
          })
          .finally(() => {
            running.delete(promise);
          });
        running.add(promise);
      }
    } catch (error) {
      recordSchedulerError(
        SMARTOLT_EVENTS_HEALTH_NAME,
        `no se pudieron listar las conexiones SmartOLT: ${errorMessage(error)}`,
      );
      log.error('could not list the SmartOLT connections', { error: errorMessage(error) });
    }

    // Sin conexiones que atender el loop queda inactivo: con la bandera
    // encendida y cero conexiones, un plazo sin dueño reportaría el loop como
    // colgado para siempre.
    publishHealth();
  })();

  return {
    enabled: true,
    get connections(): number {
      return opened;
    },
    ready,
    settled: async (): Promise<void> => {
      await Promise.all([...running]);
    },
    stop: async (): Promise<void> => {
      stopped = true;
      // Corta también la espera entre reintentos y el watchdog de cada stream.
      stopController.abort();
      for (const controller of controllers) controller.abort();
      await Promise.allSettled([...running]);
    },
  };
}
