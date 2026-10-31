/**
 * Clasificación de los errores del drenado.
 *
 * El spool solo puede mandar un evento al dead-letter cuando ese evento **no
 * se puede guardar nunca**, pase el tiempo que pase. La regla de dominio es
 * que la telemetría no se pierde: si el dead-letter se lleva un evento que
 * era guardable, el evento se perdió.
 *
 * De ahí las dos únicas categorías:
 *
 *   - `permanent` — el evento en sí es inválido para el store (viola una
 *     foreign key, un valor no entra en la columna, un dato no se puede
 *     convertir). Reintentarlo no lo va a arreglar: se manda al dead-letter
 *     para que los eventos que están detrás puedan seguir.
 *   - `transient` — el store no está disponible o la clasificación no es
 *     concluyente. Los eventos **nunca** van al dead-letter: se quedan en
 *     disco y se reintentan. Una caída de Postgres de cinco minutos tiene que
 *     ser un retraso, no una pérdida.
 *
 * Todo lo que no se reconoce cae en `transient`: equivocarse hacia el retry
 * solo retrasa la escritura, equivocarse hacia el dead-letter la pierde.
 */

/** Qué hacer con el evento que no se pudo guardar. */
export type WriteFailureClass = 'permanent' | 'transient';

/**
 * Códigos de Prisma que describen un evento imposible de guardar.
 *
 * `P2000` valor demasiado largo, `P2003` foreign key, `P2005`/`P2006` valor
 * malformado para el tipo de la columna, `P2023` datos inconsistentes en una
 * columna, `P2025` la fila referenciada no existe.
 */
const PERMANENT_PRISMA_CODES = new Set([
  'P2000',
  'P2003',
  'P2005',
  'P2006',
  'P2023',
  'P2025',
]);

/**
 * Códigos de Prisma que describen un store no disponible.
 *
 * `P1000`/`P1001`/`P1002`/`P1008` conexión y timeouts de conexión, `P1017`
 * conexión cerrada por el servidor, `P2024` timeout del pool, `P2028` error de
 * la API de transacciones.
 */
const TRANSIENT_PRISMA_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2028',
]);

/** Errores de socket de Node que describen un store no disponible. */
const TRANSIENT_SOCKET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * Códigos SQLSTATE de Postgres que describen un store no disponible.
 *
 * Las clases `08` son errores de conexión; `57P01`..`57P03` son apagado
 * administrativo, crash y "no se puede conectar ahora"; `53300` es demasiadas
 * conexiones; `40001` y `40P01` son fallos de serialización y deadlock, que se
 * resuelven reintentando.
 */
const TRANSIENT_SQLSTATE_PREFIXES = ['08'];
const TRANSIENT_SQLSTATES = new Set(['57P01', '57P02', '57P03', '53300', '40001', '40P01']);

/**
 * Clases SQLSTATE de datos e integridad: el valor no cumple el esquema.
 *
 * `22` son excepciones de datos, `23` violaciones de integridad, `42` columnas
 * o tablas inexistentes y errores de sintaxis.
 */
const PERMANENT_SQLSTATE_PREFIXES = ['22', '23', '42'];

/** Lee el campo `code` de un error sin asumir su forma. */
function codeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Lee el nombre del error sin asumir su forma. */
function nameOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

/** Lee el mensaje del error, para registrarlo como razón del dead-letter. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Decide si un evento que no se pudo guardar es permanente o pasajero.
 *
 * El orden importa: un error de Prisma trae su código en `code`, y un error de
 * Postgres trae el SQLSTATE en el mismo campo, así que se prueban los dos
 * conjuntos contra el mismo valor.
 */
/** Clasificación detallada de un fallo de escritura. */
export interface WriteFailure {
  /** Qué hacer con el evento. */
  class: WriteFailureClass;
  /**
   * Si el error está reconocido.
   *
   * `false` significa que el código no está en ninguna lista: se reintenta,
   * pero si el **mismo** evento falla así muchas veces mientras otros se
   * guardan, el problema es de ese evento y no del store.
   */
  recognized: boolean;
  /** El código tal como vino, para agrupar fallos y para el dead-letter. */
  code: string | null;
}

export function classifyWriteErrorDetailed(error: unknown): WriteFailure {
  const code = codeOf(error);
  const name = nameOf(error);

  if (name === 'PrismaClientValidationError') {
    return { class: 'permanent', recognized: true, code: 'PrismaClientValidationError' };
  }

  if (code !== null) {
    if (PERMANENT_PRISMA_CODES.has(code)) return { class: 'permanent', recognized: true, code };
    if (TRANSIENT_PRISMA_CODES.has(code)) return { class: 'transient', recognized: true, code };
    if (TRANSIENT_SOCKET_CODES.has(code)) return { class: 'transient', recognized: true, code };
    if (TRANSIENT_SQLSTATES.has(code)) return { class: 'transient', recognized: true, code };
    for (const prefix of TRANSIENT_SQLSTATE_PREFIXES) {
      if (code.startsWith(prefix) && /^\d/.test(code)) {
        return { class: 'transient', recognized: true, code };
      }
    }
    for (const prefix of PERMANENT_SQLSTATE_PREFIXES) {
      if (code.length === 5 && code.startsWith(prefix)) {
        return { class: 'permanent', recognized: true, code };
      }
    }
  }

  // Sin clasificación concluyente se reintenta: perder telemetría guardable es
  // peor que retrasarla.
  return { class: 'transient', recognized: false, code };
}

/** Decide si un evento que no se pudo guardar es permanente o pasajero. */
export function classifyWriteError(error: unknown): WriteFailureClass {
  return classifyWriteErrorDetailed(error).class;
}
