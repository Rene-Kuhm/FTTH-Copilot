import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setLogSinkForTests,
  correlationIdFrom,
  createLogger,
  resolveLogThreshold,
  type LogLevel,
} from '../src/logger';

/** What the logger wrote, parsed back from JSON. */
interface Captured {
  level: LogLevel;
  record: Record<string, unknown>;
  line: string;
}

let captured: Captured[] = [];

beforeEach(() => {
  captured = [];
  __setLogSinkForTests((line, level) => {
    captured.push({ level, line, record: JSON.parse(line) as Record<string, unknown> });
  });
  delete process.env['LOG_LEVEL'];
});

afterEach(() => {
  __setLogSinkForTests(null);
  delete process.env['LOG_LEVEL'];
  vi.restoreAllMocks();
});

const FIXED = () => new Date('2026-10-31T12:00:00.000Z');

describe('logger format', () => {
  it('writes one JSON line with time, level, name and msg first', () => {
    const log = createLogger({ name: 'worker', now: FIXED });

    log.info('schedule registered', { scope: 'poll-connections', everyMs: 900000 });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.line.endsWith('\n')).toBe(false);
    expect(captured[0]?.record).toEqual({
      time: '2026-10-31T12:00:00.000Z',
      level: 'info',
      name: 'worker',
      msg: 'schedule registered',
      scope: 'poll-connections',
      everyMs: 900000,
    });
    expect(Object.keys(captured[0]!.record).slice(0, 4)).toEqual(['time', 'level', 'name', 'msg']);
  });

  it('uses the level of the method that was called', () => {
    const log = createLogger({ name: 'x', level: 'debug' });

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(captured.map((entry) => entry.level)).toEqual(['debug', 'info', 'warn', 'error']);
    expect(captured.map((entry) => entry.record['level'])).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('never lets a field overwrite the core keys', () => {
    const log = createLogger({ name: 'real', now: FIXED });

    log.info('real message', { msg: 'forged', level: 'debug', name: 'forged', time: 'forged' });

    const record = captured[0]!.record;
    expect(record['msg']).toBe('real message');
    expect(record['level']).toBe('info');
    expect(record['name']).toBe('real');
    expect(record['time']).toBe('2026-10-31T12:00:00.000Z');
    // The data is renamed, not dropped.
    expect(record['field_msg']).toBe('forged');
    expect(record['field_level']).toBe('debug');
  });

  it('keeps a line a line when the message has a newline', () => {
    const log = createLogger({ name: 'x' });

    log.info('first\nsecond\r\nthird');

    expect(captured[0]?.line.includes('\n')).toBe(false);
    expect(captured[0]?.record['msg']).toBe('first\nsecond\r\nthird');
  });

  it('survives a circular structure and a bigint', () => {
    const log = createLogger({ name: 'x' });
    const loop: Record<string, unknown> = { name: 'loop' };
    loop['self'] = loop;

    expect(() => log.info('weird fields', { loop, big: 10n })).not.toThrow();

    const record = captured[0]!.record;
    expect(record['big']).toBe('10');
    expect(JSON.stringify(record['loop'])).toContain('[Circular]');
  });
});

describe('logger levels', () => {
  it('defaults to info', () => {
    expect(resolveLogThreshold({})).toBe('info');
    const log = createLogger({ name: 'x' });

    log.debug('hidden');
    log.info('shown');

    expect(captured.map((entry) => entry.record['msg'])).toEqual(['shown']);
  });

  it('reads LOG_LEVEL on every call', () => {
    const log = createLogger({ name: 'x' });

    process.env['LOG_LEVEL'] = 'error';
    log.warn('hidden');
    log.error('shown');
    process.env['LOG_LEVEL'] = 'debug';
    log.debug('now shown');

    expect(captured.map((entry) => entry.record['msg'])).toEqual(['shown', 'now shown']);
  });

  it('is silent when asked to be', () => {
    process.env['LOG_LEVEL'] = 'silent';
    const log = createLogger({ name: 'x' });

    log.error('nothing');

    expect(captured).toHaveLength(0);
  });

  it('falls back to info for a value it does not know', () => {
    expect(resolveLogThreshold({ LOG_LEVEL: 'verbose' })).toBe('info');
    expect(resolveLogThreshold({ LOG_LEVEL: ' WARN ' })).toBe('warn');
  });

  it('lets an explicit level win over the environment', () => {
    process.env['LOG_LEVEL'] = 'error';
    const log = createLogger({ name: 'x', level: 'debug' });

    log.debug('shown');

    expect(captured).toHaveLength(1);
  });

  it('reports whether a level is enabled', () => {
    const log = createLogger({ name: 'x', level: 'warn' });

    expect(log.isLevelEnabled('info')).toBe(false);
    expect(log.isLevelEnabled('warn')).toBe(true);
    expect(log.isLevelEnabled('error')).toBe(true);
  });
});

describe('logger context', () => {
  it('adds the bindings of a child to every line', () => {
    const log = createLogger({ name: 'api' }).child({ tenantId: 't-1', correlationId: 'req-9' });

    log.info('request done', { status: 200 });

    expect(captured[0]?.record).toMatchObject({
      tenantId: 't-1',
      correlationId: 'req-9',
      status: 200,
    });
  });

  it('merges nested children without touching the parent', () => {
    const parent = createLogger({ name: 'api' }).child({ tenantId: 't-1' });
    const child = parent.child({ correlationId: 'req-9' });

    parent.info('parent');
    child.info('child');

    expect(captured[0]?.record['correlationId']).toBeUndefined();
    expect(captured[1]?.record).toMatchObject({ tenantId: 't-1', correlationId: 'req-9' });
  });

  it('lets a field of the call win over a binding', () => {
    const log = createLogger({ name: 'x' }).child({ tenantId: 't-1' });

    log.info('override', { tenantId: 't-2' });

    expect(captured[0]?.record['tenantId']).toBe('t-2');
  });

  it('keeps the name of the parent in a child', () => {
    const log = createLogger({ name: 'scheduler' }).child({ job: 'poll' });

    log.info('tick');

    expect(captured[0]?.record['name']).toBe('scheduler');
  });
});

describe('logger errors', () => {
  it('serializes an Error instead of dumping it', () => {
    const log = createLogger({ name: 'x' });

    log.error('tick threw', { err: new TypeError('boom') });

    const err = captured[0]!.record['err'] as Record<string, unknown>;
    expect(err['name']).toBe('TypeError');
    expect(err['message']).toBe('boom');
    expect(typeof err['stack']).toBe('string');
  });

  it('truncates a very long stack', () => {
    const log = createLogger({ name: 'x' });
    const error = new Error('long');
    error.stack = `Error: long\n${'    at frame (file.ts:1:1)\n'.repeat(500)}`;

    log.error('deep', { err: error });

    const stack = (captured[0]!.record['err'] as Record<string, string>)['stack'] as string;
    expect(stack.length).toBeLessThanOrEqual(2100);
    expect(stack.endsWith('…')).toBe(true);
  });

  it('includes the message of the cause', () => {
    const log = createLogger({ name: 'x' });

    log.error('wrapped', { err: new Error('outer', { cause: new Error('inner') }) });

    const err = captured[0]!.record['err'] as Record<string, unknown>;
    expect(err['cause']).toMatchObject({ message: 'inner' });
  });
});

describe('default sink', () => {
  it('writes info to stdout and warn/error to stderr', () => {
    __setLogSinkForTests(null);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const log = createLogger({ name: 'x' });

    log.info('to stdout');
    log.warn('to stderr');
    log.error('also stderr');

    expect(out).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(2);
    expect(String(out.mock.calls[0]?.[0]).endsWith('\n')).toBe(true);
  });
});

describe('correlationIdFrom', () => {
  const headers = (values: Record<string, string>) => ({
    get: (name: string) => values[name.toLowerCase()] ?? null,
  });

  it('reuses a well-formed x-correlation-id', () => {
    expect(correlationIdFrom(headers({ 'x-correlation-id': 'abc-123_DEF.9' }))).toBe('abc-123_DEF.9');
  });

  it('falls back to x-request-id', () => {
    expect(correlationIdFrom(headers({ 'x-request-id': 'req-77' }))).toBe('req-77');
  });

  it('generates one when there is no header', () => {
    const id = correlationIdFrom(headers({}));

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not trust a header that could forge a log line', () => {
    const hostile = 'ok"}\n{"level":"error","msg":"forged"';

    const id = correlationIdFrom(headers({ 'x-correlation-id': hostile }));

    expect(id).not.toBe(hostile);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not accept an id that is too long', () => {
    const id = correlationIdFrom(headers({ 'x-correlation-id': 'a'.repeat(200) }));

    expect(id.length).toBeLessThanOrEqual(128);
  });

  it('accepts no headers at all', () => {
    expect(correlationIdFrom(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
