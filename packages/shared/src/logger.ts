/**
 * Structured logger.
 *
 * One JSON object per line on stdout (info/debug) or stderr (warn/error), which
 * is what the compose stack and the runtime already collect. The shape is
 * fixed and the core keys come first:
 *
 *   {"time":"…","level":"info","name":"worker","msg":"…", …fields, …bindings}
 *
 * Two decisions worth knowing:
 *
 *   - **Every value goes through the redactor.** Secrets, SNMP communities and
 *     customer data are redacted by key *and* by pattern in the free text, so a
 *     community that ended up inside an error message ("Local community not
 *     found for message with community X") does not leak either.
 *   - **The context is explicit.** `child()` carries the bindings down. There
 *     is no `AsyncLocalStorage`: `node:async_hooks` in this package would break
 *     any Edge bundle that imports `shared`, and the web middleware runs on
 *     Edge.
 */
import { randomUUID } from 'node:crypto';
import { createRedactor, REDACTED_MARKER, type RedactionPattern } from './redaction';

/** The levels, from most to least verbose. `silent` turns logging off. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Fields of a line. A value can be anything serializable. */
export type LogFields = Record<string, unknown>;

/** Where a line goes. Exists so a test can capture instead of writing. */
export type LogSink = (line: string, level: LogLevel) => void;

/** The keys the logger owns: a field can never overwrite them. */
const CORE_KEYS = ['time', 'level', 'name', 'msg'] as const;

/** How much of a stack is kept. A stack is for orientation, not for storage. */
const MAX_STACK_CHARS = 2000;

/**
 * Keys that are secrets, SNMP communities or customer data.
 *
 * Compared without case and without `-`/`_`, so `community`, `Community` and
 * `x-api-key`/`x_api_key` all match.
 */
const LOG_REDACTED_KEYS: readonly string[] = [
  // SNMP communities and SNMPv3 keys
  'community',
  'communitystring',
  'snmpcommunity',
  'readcommunity',
  'writecommunity',
  'authkey',
  'privkey',
  'authpassword',
  'privpassword',
  'securityname',
  // Customer data
  'email',
  'correo',
  'mail',
  'phone',
  'telefono',
  'movil',
  'celular',
  'whatsapp',
  'cedula',
  'dni',
  'documento',
  'address',
  'direccion',
  'domicilio',
  'nombre',
  'customername',
  'customeremail',
  'customerphone',
  'cliente',
];

/**
 * Patterns applied to every string that reaches the log.
 *
 * Order matters: the base redactor already removed credentials, so these only
 * have to cover what is specific to a log line.
 */
const LOG_PATTERNS: readonly RedactionPattern[] = [
  // The receiver's own message hides the community in the text. The
  // assignment form (`community=x`) is unambiguous. The prose form
  // ("... with community x") only redacts when the next word is not an
  // ordinary word of the message itself: "community not found" has to stay
  // readable.
  {
    pattern: /(community[=:]\s*)(?![\[("']?REDACTED)[^\s,;)"]+/gi,
    replacement: `$1${REDACTED_MARKER}`,
  },
  {
    pattern:
      /(\bcommunity\s+)(?!(?:not|found|string|value|name|is|was|rejected|missing|for|of|undefined|null|empty|and|or|with|from|set|required|configured)\b)([^\s,;)"]+)/gi,
    replacement: `$1${REDACTED_MARKER}`,
  },
  // An email in a free-text message.
  {
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
    replacement: REDACTED_MARKER,
  },
];

const logRedactor = createRedactor({
  extraKeys: LOG_REDACTED_KEYS,
  extraPatterns: LOG_PATTERNS,
});

/** Reads `LOG_LEVEL`, falling back to `info`. */
export function resolveLogThreshold(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const raw = env['LOG_LEVEL']?.trim().toLowerCase();
  if (!raw) return 'info';
  return (LOG_LEVELS as readonly string[]).includes(raw) ? (raw as LogLevel) : 'info';
}

function rank(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

/**
 * Whether `level` passes a `threshold`.
 *
 * Exported because the test sink and the default sink share it, and because a
 * caller may want to skip building an expensive payload.
 */
export function isLevelEnabled(level: LogLevel, threshold: LogLevel): boolean {
  if (threshold === 'silent') return false;
  if (level === 'silent') return false;
  return rank(level) >= rank(threshold);
}

/** The default sink: one line to stdout, or to stderr for warn/error. */
const defaultSink: LogSink = (line, level) => {
  const target = rank(level) >= rank('warn') ? process.stderr : process.stdout;
  target.write(`${line}\n`);
};

let sink: LogSink = defaultSink;

/** Test seam: capture the lines instead of writing them. `null` restores. */
export function __setLogSinkForTests(next: LogSink | null): void {
  sink = next ?? defaultSink;
}

/**
 * Turns anything into something JSON can hold.
 *
 * `JSON.stringify` throws on a circular structure and on a `bigint`, and a
 * logger that throws takes the caller down with it. An Error becomes an object
 * with `name`, `message`, a truncated `stack` and its `cause`.
 */
function serializable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: logRedactor.redactString(value.message),
    };
    if (typeof value.stack === 'string') {
      const stack = logRedactor.redactString(value.stack);
      out['stack'] =
        stack.length > MAX_STACK_CHARS ? `${stack.slice(0, MAX_STACK_CHARS)}…` : stack;
    }
    const cause = (value as { cause?: unknown }).cause;
    if (cause !== undefined) out['cause'] = serializable(cause, seen);
    return out;
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => serializable(item, seen));

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = serializable(entry, seen);
  }
  return out;
}

/** A logger bound to a name and, optionally, to a context. */
export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger that carries `bindings` on every line. */
  child(bindings: LogFields): Logger;
  /** Whether a level would be written right now. */
  isLevelEnabled(level: LogLevel): boolean;
}

/** Options of `createLogger`. */
export interface LoggerOptions {
  /** Name of the component; it is the `name` of every line. */
  name: string;
  /** Fixed level. Defaults to `LOG_LEVEL` on every call. */
  level?: LogLevel;
  /** Clock, for tests. */
  now?: () => Date;
}

/**
 * Builds a logger.
 *
 * The threshold is read on every call unless a level was passed explicitly, so
 * a process that changes `LOG_LEVEL` (or a test) does not need to be rebuilt.
 */
export function createLogger(options: LoggerOptions): Logger {
  const now = options.now ?? (() => new Date());
  const fixedLevel = options.level;

  function write(level: Exclude<LogLevel, 'silent'>, msg: string, fields: LogFields, bindings: LogFields): void {
    const threshold = fixedLevel ?? resolveLogThreshold();
    if (!isLevelEnabled(level, threshold)) return;

    // Bindings first, so a field of the call can override a binding of the
    // context (the more specific wins), and the core keys last, so nothing can
    // forge them.
    const merged: Record<string, unknown> = { ...bindings, ...fields };
    for (const key of CORE_KEYS) {
      if (key in merged) {
        // The data is kept, renamed: dropping it would hide a real collision.
        merged[`field_${key}`] = merged[key];
        delete merged[key];
      }
    }

    // Serialize first (circular structures, bigint, Error), then redact: the
    // redactor iterates plain objects, and an Error has no own properties to
    // iterate, so an unserialized error would go through untouched.
    const safe = logRedactor.redactSensitiveData(serializable(merged)) as Record<string, unknown>;
    const record: Record<string, unknown> = {
      time: now().toISOString(),
      level,
      name: options.name,
      msg: logRedactor.redactString(msg),
      ...safe,
    };

    sink(JSON.stringify(record), level);
  }

  function build(bindings: LogFields): Logger {
    return {
      debug: (msg, fields = {}) => write('debug', msg, fields, bindings),
      info: (msg, fields = {}) => write('info', msg, fields, bindings),
      warn: (msg, fields = {}) => write('warn', msg, fields, bindings),
      error: (msg, fields = {}) => write('error', msg, fields, bindings),
      child: (extra) => build({ ...bindings, ...extra }),
      isLevelEnabled: (level) => isLevelEnabled(level, fixedLevel ?? resolveLogThreshold()),
    };
  }

  return build({});
}

/** The shape of the object a route or a job passes to `correlationIdFrom`. */
export interface HeaderReader {
  get(name: string): string | null;
}

/** A correlation id that is safe to put in a log line. */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * The correlation id of a request.
 *
 * Reuses an incoming `x-correlation-id` (or `x-request-id`) only when it is
 * well formed: the value ends up inside a JSON line, and a header with quotes
 * or a newline is how a forged log entry gets written. Anything else gets a
 * fresh id.
 */
export function correlationIdFrom(headers: HeaderReader | undefined): string {
  for (const name of ['x-correlation-id', 'x-request-id']) {
    const value = headers?.get(name)?.trim();
    if (value && SAFE_CORRELATION_ID.test(value)) return value;
  }
  return randomUUID();
}

export { REDACTED_MARKER };
