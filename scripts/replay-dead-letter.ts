#!/usr/bin/env tsx
/**
 * replay:dead-letter — devuelve al spool los eventos que el drainer mandó al
 * dead-letter.
 *
 *   pnpm replay:dead-letter -- --dry-run
 *   pnpm replay:dead-letter -- --tenant tenant-acme
 *   pnpm replay:dead-letter -- --spool-dir /var/lib/ftth/spool
 *
 * El dead-letter guarda los datos pero, sin un replay, no los devuelve: en la
 * práctica es pérdida. Cuando el operador corrige el registro en el NMS, los
 * traps tienen que poder volver.
 *
 * Dos cosas que el comando no negocia:
 *
 *   - **El spool pertenece a un solo proceso.** Para reprocesar hay que
 *     parar el worker (o el proceso que tiene el directorio). El `--dry-run`
 *     no abre el spool, así que funciona con todo corriendo.
 *   - **Los ids se conservan.** El `ingestId` es la clave de idempotencia del
 *     insert (`DeviceEvent.ingestId` es único), así que un evento que ya se
 *     guardó vuelve con el mismo id y la base lo absorbe en vez de duplicarlo.
 *     Un replay repetido no agrega filas.
 */
import { replayDeadLetter, type DeviceEventPayload } from '@ftth-copilot/ingest';
import { join } from 'node:path';

interface CliOptions {
  dryRun: boolean;
  tenantId?: string;
  dir: string;
  /** Leave the replayed records in the dead-letter file. */
  keep: boolean;
  /** Ask the database how many of the recovered events it already had. */
  countDuplicates: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    dir: process.env['EVENT_SPOOL_DIR']?.trim() || join(process.cwd(), '.spool'),
    keep: false,
    countDuplicates: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // `pnpm replay:dead-letter -- --dry-run` deja el separador en los
    // argumentos; no es un error del operador.
    if (arg === '--') continue;
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--keep') {
      options.keep = true;
    } else if (arg === '--count-duplicates') {
      options.countDuplicates = true;
    } else if (arg === '--tenant') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--tenant necesita un valor.');
      options.tenantId = value;
      i += 1;
    } else if (arg === '--spool-dir') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--spool-dir necesita un valor.');
      options.dir = value;
      i += 1;
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }

  return options;
}

/**
 * Counts how many of the ids the database already has.
 *
 * Best effort and opt-in: the replay works with the database down (that is
 * the moment it matters most), so the count never fails the command. It is
 * only asked for with `--count-duplicates`, because the connection noise of a
 * database that is down is not something an operator needs while replaying.
 */
async function countAlreadyStored(ingestIds: readonly string[]): Promise<number | null> {
  if (ingestIds.length === 0) return 0;
  if (!process.env['DATABASE_URL']) {
    console.log('Duplicados (ya en la base): no se pudo contar, falta DATABASE_URL.');
    return null;
  }

  try {
    const { prisma } = await import('@ftth-copilot/db');
    try {
      let stored = 0;
      // Batches: Postgres has a limit of bind parameters per query.
      for (let i = 0; i < ingestIds.length; i += 500) {
        const batch = ingestIds.slice(i, i + 500);
        stored += await prisma.deviceEvent.count({ where: { ingestId: { in: batch } } });
      }
      return stored;
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message.trim() : String(err);
    const reason = message.split('\n')[0] || (err instanceof Error ? err.name : 'error desconocido');
    console.log(`Duplicados (ya en la base): no se pudo contar (${reason}).`);
    return null;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.log(`Spool: ${options.dir}`);
  if (options.dryRun) console.log('Modo: dry-run (no escribe nada).');
  if (options.tenantId) console.log(`Tenant: ${options.tenantId}`);

  let result;
  try {
    result = replayDeadLetter<DeviceEventPayload>({
      dir: options.dir,
      tenantId: options.tenantId,
      dryRun: options.dryRun,
      consume: !options.keep,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('already owned')) {
      console.error(
        'El spool está en uso por otro proceso: paralo antes de reprocesar.\n' +
          'El directorio del spool pertenece a un solo proceso (el worker), porque dos\n' +
          'procesos sobre el mismo offset perderían o duplicarían eventos.\n' +
          'El --dry-run no abre el spool y funciona con el worker corriendo.',
      );
      process.exit(1);
    }
    throw err;
  }

  const stored = options.countDuplicates ? await countAlreadyStored(result.ingestIds) : null;

  console.log('');
  console.log(`Dead-letter encontrados: ${result.found}`);
  console.log(`Recuperados al spool:    ${result.recovered}`);
  console.log(`Omitidos (otro tenant):  ${result.skipped}`);
  console.log(`Ilegibles:               ${result.unreadable}`);
  console.log(`Rechazados por el spool: ${result.refused}`);
  console.log(`Quedan en el dead-letter: ${result.remaining}`);

  if (stored === null) {
    if (options.countDuplicates) {
      console.log(
        'El replay es idempotente igual: el ingestId es único y la base absorbe\n' +
          'el duplicado cuando el drainer inserte el evento.',
      );
    }
  } else {
    console.log(`Duplicados (ya en la base): ${stored}`);
    console.log(`Nuevos para la base:        ${result.recovered - stored}`);
  }

  if (options.dryRun) {
    console.log('');
    console.log('Dry-run: no se escribió nada.');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
