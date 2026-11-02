import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableSpool } from '../src/spool';
import { replayDeadLetter } from '../src/dead-letter-replay';

/**
 * El dead-letter guarda los datos pero, sin un replay, no los devuelve: en la
 * práctica es pérdida. Este comando los devuelve al spool.
 *
 * La propiedad que lo hace seguro es el `ingestId`: es la clave de
 * idempotencia del insert (`createMany` con `skipDuplicates`), así que un
 * evento que ya se guardó vuelve al spool con el mismo id y la base lo
 * descarta en vez de duplicarlo.
 */
interface Payload {
  tenantId: string;
  message: string;
}

describe('replay del dead-letter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dlq-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Escribe un dead-letter a mano, como lo deja el drainer. */
  function writeDeadLetter(records: Array<Record<string, unknown>>): void {
    const lines = records.map((record) => JSON.stringify(record));
    writeFileSync(join(dir, 'events.dlq.jsonl'), `${lines.join('\n')}\n`);
  }

  function deadLetterRecord(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      ingestId: 'boot-1-a',
      payload: { tenantId: 'tenant-a', message: 'link down' },
      reason: 'foreign key violated',
      deadLetteredAt: '2026-11-01T10:00:00.000Z',
      ...overrides,
    };
  }

  it('devuelve al spool los eventos del dead-letter conservando su ingestId', () => {
    writeDeadLetter([deadLetterRecord()]);

    const result = replayDeadLetter<Payload>({ dir });

    expect(result.recovered).toBe(1);
    expect(result.found).toBe(1);
    // Los ids recuperados: el operador los necesita para saber cuántos de
    // ellos la base ya tenía (y por lo tanto va a absorber como duplicados).
    expect(result.ingestIds).toEqual(['boot-1-a']);

    // El spool tiene que devolver el mismo id: con uno nuevo, la base
    // insertaría una fila duplicada en vez de reconocer el evento.
    const spool = new DurableSpool<Payload>({ dir });
    const { entries } = spool.readBatch(10);
    spool.close();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.ingestId).toBe('boot-1-a');
    expect(entries[0]?.payload.message).toBe('link down');
  });

  it('consume del dead-letter lo que recuperó', () => {
    writeDeadLetter([deadLetterRecord()]);

    const result = replayDeadLetter<Payload>({ dir });

    expect(result.remaining).toBe(0);
    expect(readFileSync(join(dir, 'events.dlq.jsonl'), 'utf8').trim()).toBe('');
  });

  it('deja en el dead-letter lo que no recuperó', () => {
    writeDeadLetter([
      deadLetterRecord({ ingestId: 'boot-1-a' }),
      deadLetterRecord({ ingestId: 'boot-1-b', payload: { tenantId: 'tenant-b', message: 'other' } }),
    ]);

    const result = replayDeadLetter<Payload>({ dir, tenantId: 'tenant-a' });

    expect(result.recovered).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.remaining).toBe(1);

    const dlq = readFileSync(join(dir, 'events.dlq.jsonl'), 'utf8');
    expect(dlq).toContain('boot-1-b');
    expect(dlq).not.toContain('boot-1-a');
  });

  it('filtra por tenant', () => {
    writeDeadLetter([
      deadLetterRecord({ ingestId: 'boot-1-a', payload: { tenantId: 'tenant-a', message: 'a' } }),
      deadLetterRecord({ ingestId: 'boot-1-b', payload: { tenantId: 'tenant-b', message: 'b' } }),
    ]);

    const result = replayDeadLetter<Payload>({ dir, tenantId: 'tenant-b' });

    expect(result.recovered).toBe(1);
    expect(result.skipped).toBe(1);

    const spool = new DurableSpool<Payload>({ dir });
    const { entries } = spool.readBatch(10);
    spool.close();
    expect(entries.map((e) => e.ingestId)).toEqual(['boot-1-b']);
  });

  it('no escribe nada en dry-run', () => {
    writeDeadLetter([deadLetterRecord()]);

    const result = replayDeadLetter<Payload>({ dir, dryRun: true });

    expect(result.found).toBe(1);
    expect(result.recovered).toBe(0);
    expect(result.remaining).toBe(1);

    // El spool ni se abre: en dry-run el comando tiene que servir con el
    // worker corriendo, que es el dueño del directorio.
    expect(existsSync(join(dir, 'events.jsonl'))).toBe(false);
    expect(readFileSync(join(dir, 'events.dlq.jsonl'), 'utf8')).toContain('boot-1-a');
  });

  it('cuenta las líneas ilegibles y las deja en el archivo', () => {
    writeFileSync(
      join(dir, 'events.dlq.jsonl'),
      `${JSON.stringify(deadLetterRecord())}\nno es json\n`,
    );

    const result = replayDeadLetter<Payload>({ dir });

    expect(result.found).toBe(2);
    expect(result.unreadable).toBe(1);
    expect(result.recovered).toBe(1);
    expect(result.remaining).toBe(1);
    expect(readFileSync(join(dir, 'events.dlq.jsonl'), 'utf8')).toContain('no es json');
  });

  it('no hace nada cuando no hay dead-letter', () => {
    const result = replayDeadLetter<Payload>({ dir });

    expect(result.found).toBe(0);
    expect(result.recovered).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('falla con un mensaje claro cuando el spool está tomado por otro proceso', () => {
    writeDeadLetter([deadLetterRecord()]);
    const owner = new DurableSpool<Payload>({ dir });

    expect(() => replayDeadLetter<Payload>({ dir })).toThrow(/ya está en uso|already owned/);

    owner.close();
  });
});
