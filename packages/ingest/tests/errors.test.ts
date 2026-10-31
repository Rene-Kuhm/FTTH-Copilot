import { describe, expect, it } from 'vitest';
import { classifyWriteError, errorMessage } from '../src/errors';

/**
 * La clasificación decide si un evento se pierde o solo se retrasa.
 *
 * `permanent` manda el evento al dead-letter; `transient` lo deja en disco.
 * Equivocarse hacia `permanent` pierde telemetría guardable, así que lo que no
 * se reconoce tiene que ser `transient`.
 */
function withCode(code: string, message = 'boom'): Error {
  return Object.assign(new Error(message), { code });
}

describe('classifyWriteError', () => {
  it.each(['P2000', 'P2003', 'P2005', 'P2006', 'P2023', 'P2025'])(
    'treats the Prisma integrity/validation code %s as permanent',
    (code) => {
      expect(classifyWriteError(withCode(code))).toBe('permanent');
    },
  );

  it.each(['P1000', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028'])(
    'treats the Prisma connection code %s as transient',
    (code) => {
      expect(classifyWriteError(withCode(code))).toBe('transient');
    },
  );

  it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'])(
    'treats the socket error %s as transient',
    (code) => {
      expect(classifyWriteError(withCode(code))).toBe('transient');
    },
  );

  it.each(['22503', '23503', '23502', '42703', '42P01'])(
    'treats the Postgres data/integrity SQLSTATE %s as permanent',
    (code) => {
      expect(classifyWriteError(withCode(code))).toBe('permanent');
    },
  );

  it.each(['08006', '08003', '57P01', '57P02', '57P03', '53300', '40001', '40P01'])(
    'treats the Postgres connection SQLSTATE %s as transient',
    (code) => {
      expect(classifyWriteError(withCode(code))).toBe('transient');
    },
  );

  it('treats a Prisma validation error as permanent', () => {
    const error = Object.assign(new Error('Argument `tenantId` is missing'), {
      name: 'PrismaClientValidationError',
    });
    expect(classifyWriteError(error)).toBe('permanent');
  });

  it('treats an unrecognized error as transient', () => {
    // The safe default: a wrong guess here only delays the write.
    expect(classifyWriteError(new Error('something nobody planned for'))).toBe('transient');
    expect(classifyWriteError(withCode('ZZ999'))).toBe('transient');
    expect(classifyWriteError(withCode('P9999'))).toBe('transient');
  });

  it('treats a non-error value as transient', () => {
    expect(classifyWriteError('a string')).toBe('transient');
    expect(classifyWriteError(undefined)).toBe('transient');
  });

  it('does not mistake a Prisma code for a SQLSTATE', () => {
    // `P2003` empieza con "P2"; los SQLSTATE permanentes son de 5 dígitos.
    expect(classifyWriteError(withCode('P2003'))).toBe('permanent');
    expect(classifyWriteError(withCode('22'))).toBe('transient');
  });
});

describe('errorMessage', () => {
  it('reads the message of an Error and stringifies anything else', () => {
    expect(errorMessage(new Error('fk violated'))).toBe('fk violated');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage({ nope: true })).toBe('[object Object]');
  });
});
