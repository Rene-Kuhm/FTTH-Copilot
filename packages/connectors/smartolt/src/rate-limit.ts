import { SmartoltRateLimitError, type SmartoltViolationType } from './errors';

/** Milisegundos en la ventana del presupuesto por hora. */
const HOUR_MS = 3_600_000;

/** Milisegundos en la ventana del guardia por segundo. */
const SECOND_MS = 1_000;

/**
 * El presupuesto de llamadas que la API de SmartOLT publica y nosotros
 * respetamos.
 *
 * La documentación oficial (octubre 2026) dice: 1.000 llamadas por hora para
 * la cuenta, 15 por segundo, y bloqueo de todas las llamadas durante 10
 * segundos si se pasa el límite por segundo. Los topes por endpoint (el export
 * completo de ONUs, 15 por hora) se respetan no llamándolos: el conector
 * pagina.
 */
export interface SmartoltRateLimitConfig {
  /** Llamadas por hora antes de negarse a llamar. */
  perHour: number;
  /** Llamadas por segundo antes de esperar el hueco. */
  perSecond: number;
  /** La espera más larga que el cliente acepta hacer por un `Retry-After`. */
  maxRetryAfterMs: number;
  /** Cuántas veces se reintenta un 429 antes de fallar. */
  maxRetries: number;
}

/** El presupuesto por defecto: el que publica la API. */
export const SMARTOLT_DEFAULT_RATE_LIMIT: SmartoltRateLimitConfig = {
  perHour: 1_000,
  perSecond: 15,
  maxRetryAfterMs: 30_000,
  maxRetries: 2,
};

/** Lo que un llamador puede pisar del presupuesto. */
export type SmartoltRateLimitOverrides = Partial<SmartoltRateLimitConfig>;

/** Un entero positivo del entorno, o `undefined` si no lo es. */
function positiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number.parseInt(trimmed, 10);
  return value > 0 ? value : undefined;
}

/** Un entero no negativo del entorno: el cero es un valor válido (`maxRetries: 0`). */
function nonNegativeInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number.parseInt(trimmed, 10);
}

/**
 * Resuelve el presupuesto: el entorno primero, la opción del cliente encima.
 *
 * Las variables son `SMARTOLT_RATE_LIMIT_PER_HOUR`,
 * `SMARTOLT_RATE_LIMIT_PER_SECOND`, `SMARTOLT_MAX_RETRY_AFTER_MS` y
 * `SMARTOLT_RATE_LIMIT_MAX_RETRIES`. Un valor que no sea un entero positivo se
 * ignora: un presupuesto mal escrito no puede dejar al conector sin llamar.
 */
export function resolveSmartoltRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: SmartoltRateLimitOverrides = {},
): SmartoltRateLimitConfig {
  const fromEnv: SmartoltRateLimitConfig = {
    perHour: positiveInt(env['SMARTOLT_RATE_LIMIT_PER_HOUR']) ?? SMARTOLT_DEFAULT_RATE_LIMIT.perHour,
    perSecond:
      positiveInt(env['SMARTOLT_RATE_LIMIT_PER_SECOND']) ?? SMARTOLT_DEFAULT_RATE_LIMIT.perSecond,
    maxRetryAfterMs:
      positiveInt(env['SMARTOLT_MAX_RETRY_AFTER_MS']) ?? SMARTOLT_DEFAULT_RATE_LIMIT.maxRetryAfterMs,
    maxRetries:
      nonNegativeInt(env['SMARTOLT_RATE_LIMIT_MAX_RETRIES']) ??
      SMARTOLT_DEFAULT_RATE_LIMIT.maxRetries,
  };

  const resolved: SmartoltRateLimitConfig = { ...fromEnv };
  for (const key of Object.keys(overrides) as Array<keyof SmartoltRateLimitConfig>) {
    const value = overrides[key];
    if (value !== undefined) resolved[key] = value;
  }
  return resolved;
}

/** El reloj y el `sleep` que el guardia usa (inyectables para los tests). */
export interface SmartoltGovernorClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/**
 * El guardia de llamadas de una instancia del cliente.
 *
 * Tres reglas, en este orden:
 *
 *   1. Si el servidor dijo que no queda presupuesto (`X-RateLimit-Remaining: 0`)
 *      y publicó cuándo se reinicia (`X-RateLimit-Reset`), espera ese reset.
 *   2. Si se gastó el presupuesto local de la hora, espera el reinicio de la
 *      ventana o falla si la espera es más larga que el tope configurado.
 *   3. No más de `perSecond` llamadas en la ventana de un segundo: espera el
 *      hueco.
 *
 * Nunca duerme más de `maxRetryAfterMs` de una vez: cuando la espera que haría
 * falta supera el tope, falla con `SmartoltRateLimitError` y deja el
 * `retryAfterSeconds` para que decida quien orquesta (el scheduler), que es el
 * único que sabe cuándo conviene volver.
 */
export class SmartoltRateGovernor {
  private readonly config: SmartoltRateLimitConfig;
  private readonly clock: SmartoltGovernorClock;
  private windowStartMs: number;
  private windowCalls = 0;
  private secondWindow: number[] = [];
  private serverRemaining?: number;
  private serverResetAtMs?: number;

  constructor(config: SmartoltRateLimitConfig, clock: Partial<SmartoltGovernorClock> = {}) {
    this.config = config;
    this.clock = {
      now: clock.now ?? (() => Date.now()),
      sleep:
        clock.sleep ??
        ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    };
    this.windowStartMs = this.clock.now();
  }

  /** Anota lo que el servidor publicó del presupuesto en la respuesta. */
  observeResponse(headers: Headers, _endpoint: string): void {
    const remaining = positiveIntOrZero(headers.get('X-RateLimit-Remaining'));
    const resetSeconds = positiveIntOrZero(headers.get('X-RateLimit-Reset'));

    if (remaining !== undefined) this.serverRemaining = remaining;
    if (remaining !== undefined && remaining > 0) this.serverResetAtMs = undefined;

    if (resetSeconds !== undefined) {
      // `X-RateLimit-Reset` son los segundos que faltan para que se reinicie el
      // presupuesto: alinear la ventana local con ese instante hace que el
      // contador de la hora caduque cuando caduca el del servidor.
      this.serverResetAtMs = this.clock.now() + resetSeconds * SECOND_MS;
      this.windowStartMs = this.serverResetAtMs - HOUR_MS;
    }
  }

  /** Consume una llamada del presupuesto, esperando el hueco si hace falta. */
  async beforeRequest(endpoint: string): Promise<void> {
    await this.waitForServerReset(endpoint);

    const now = this.clock.now();
    if (now - this.windowStartMs >= HOUR_MS) {
      this.windowStartMs = now;
      this.windowCalls = 0;
    }
    if (this.windowCalls >= this.config.perHour) {
      await this.waitOrFail(
        this.windowStartMs + HOUR_MS - now,
        endpoint,
        'per_hour',
        `SmartOLT: se gastó el presupuesto de ${this.config.perHour} llamadas por hora`,
      );
      this.windowStartMs = this.clock.now();
      this.windowCalls = 0;
    }

    this.pruneSecondWindow();
    while (this.secondWindow.length >= this.config.perSecond) {
      const oldest = this.secondWindow[0] ?? this.clock.now();
      await this.waitOrFail(
        oldest + SECOND_MS - this.clock.now(),
        endpoint,
        'per_second',
        `SmartOLT: se llegó al tope de ${this.config.perSecond} llamadas por segundo`,
      );
      this.pruneSecondWindow();
    }

    const consumedAt = this.clock.now();
    this.secondWindow.push(consumedAt);
    this.windowCalls += 1;
  }

  private async waitForServerReset(endpoint: string): Promise<void> {
    if (this.serverRemaining === undefined || this.serverRemaining > 0) return;
    const resetAtMs = this.serverResetAtMs;
    if (resetAtMs === undefined) return;

    const waitMs = resetAtMs - this.clock.now();
    if (waitMs <= 0) {
      this.serverRemaining = undefined;
      this.serverResetAtMs = undefined;
      return;
    }

    await this.waitOrFail(
      waitMs,
      endpoint,
      'per_hour',
      'SmartOLT: el presupuesto de la hora está agotado (X-RateLimit-Remaining: 0)',
    );
    this.serverRemaining = undefined;
    this.serverResetAtMs = undefined;
    this.windowStartMs = this.clock.now();
    this.windowCalls = 0;
  }

  private async waitOrFail(
    waitMs: number,
    endpoint: string,
    violationType: SmartoltViolationType,
    message: string,
  ): Promise<void> {
    const bounded = Math.max(waitMs, 0);
    if (bounded > this.config.maxRetryAfterMs) {
      const retryAfterSeconds = Math.ceil(bounded / SECOND_MS);
      throw new SmartoltRateLimitError(
        `${message}: habría que esperar ${retryAfterSeconds}s y el tope de espera es ` +
          `${Math.round(this.config.maxRetryAfterMs / SECOND_MS)}s.`,
        { violationType, retryAfterSeconds, endpoint, attempts: 0 },
      );
    }
    if (bounded > 0) await this.clock.sleep(bounded);
  }

  private pruneSecondWindow(): void {
    const now = this.clock.now();
    while (this.secondWindow.length > 0 && now - (this.secondWindow[0] ?? now) >= SECOND_MS) {
      this.secondWindow.shift();
    }
  }
}

/** Un entero no negativo de un header, o `undefined` si el header no está. */
function positiveIntOrZero(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number.parseInt(trimmed, 10);
}

/** Los segundos de `Retry-After`, o `undefined` si falta o no es un número. */
export function readRetryAfterSeconds(headers: Headers): number | undefined {
  return positiveIntOrZero(headers.get('Retry-After'));
}

/**
 * Lee `violation_type` y `retry_after` del cuerpo de un 429.
 *
 * El cuerpo de un 429 por presupuesto de cuenta trae `response_code:
 * "rate_limit_exceeded"`; el de un 429 por límite de endpoint trae `error` y
 * `error_code`. En los dos casos `retry_after` es el mismo número que el
 * header.
 */
export function readRateLimitBody(body: unknown): {
  violationType?: SmartoltViolationType;
  retryAfterSeconds?: number;
} {
  if (typeof body !== 'object' || body === null) return {};
  const record = body as Record<string, unknown>;

  const rawViolation = record['violation_type'];
  const violationType = normalizeViolationType(rawViolation);

  const rawRetryAfter = record['retry_after'];
  const retryAfterSeconds =
    typeof rawRetryAfter === 'number' && Number.isFinite(rawRetryAfter) && rawRetryAfter >= 0
      ? Math.ceil(rawRetryAfter)
      : positiveInt(typeof rawRetryAfter === 'string' ? rawRetryAfter : undefined);

  return {
    ...(violationType === undefined ? {} : { violationType }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

function normalizeViolationType(raw: unknown): SmartoltViolationType | undefined {
  if (typeof raw !== 'string') return undefined;
  switch (raw.trim().toLowerCase()) {
    case 'per_hour':
      return 'per_hour';
    case 'per_10min':
      return 'per_10min';
    case 'per_second':
      return 'per_second';
    case 'per_endpoint':
      return 'per_endpoint';
    default:
      return undefined;
  }
}

/**
 * El presupuesto de un endpoint con su propio tope por hora.
 *
 * La API de octubre 2026 pone topes por endpoint además del de la cuenta: el
 * stream de eventos se puede pedir 60 veces por hora. Contarlos con el guardia
 * de la cuenta no alcanza —ese guardia mide 1.000—, así que este contador
 * aparte lleva la ventana del endpoint y falla con el mismo error tipado.
 *
 * No duerme: quien llama decide si espera o vuelve más tarde, que es lo único
 * que sabe el orquestador.
 */
export class SmartoltHourlyBudget {
  private readonly perHour: number;
  private readonly clock: SmartoltGovernorClock;
  private windowStartMs: number;
  private calls = 0;

  constructor(perHour: number, clock: Partial<SmartoltGovernorClock> = {}) {
    this.perHour = perHour;
    this.clock = {
      now: clock.now ?? (() => Date.now()),
      sleep:
        clock.sleep ??
        ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    };
    this.windowStartMs = this.clock.now();
  }

  /** Llamadas gastadas en la ventana vigente. */
  get used(): number {
    this.roll();
    return this.calls;
  }

  /** Cuántas llamadas quedan en la ventana vigente. */
  get remaining(): number {
    return Math.max(0, this.perHour - this.used);
  }

  /**
   * Consume una llamada, o falla con `SmartoltRateLimitError`.
   *
   * `per_endpoint` es el motivo: es el tope del endpoint, no el de la cuenta.
   */
  consume(endpoint: string): void {
    this.roll();
    if (this.calls >= this.perHour) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((this.windowStartMs + HOUR_MS - this.clock.now()) / SECOND_MS),
      );
      throw new SmartoltRateLimitError(
        `SmartOLT: se gastó el presupuesto de ${this.perHour} llamadas por hora de ${endpoint}`,
        { violationType: 'per_endpoint', retryAfterSeconds, endpoint, attempts: 0 },
      );
    }
    this.calls += 1;
  }

  private roll(): void {
    const now = this.clock.now();
    if (now - this.windowStartMs >= HOUR_MS) {
      this.windowStartMs = now;
      this.calls = 0;
    }
  }
}
