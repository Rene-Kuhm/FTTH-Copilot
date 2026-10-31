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
 * Códigos de Prisma que describen un **dato** que no entra en el esquema.
 *
 * `P2000` valor demasiado largo, `P2003` foreign key, `P2005`/`P2006` valor
 * malformado para el tipo de la columna, `P2023` datos inconsistentes en una
 * columna, `P2025` la fila referenciada no existe.
 *
 * Son de ese evento por naturaleza: se mandan al dead-letter uno por uno
 * aunque fallen doscientos seguidos con el mismo código.
 */
const DATA_PRISMA_CODES = new Set([
  'P2000',
  'P2003',
  'P2005',
  'P2006',
  'P2023',
  'P2025',
]);

/**
 * Códigos de Prisma que describen un **esquema** que no está listo.
 *
 * `P2021`/`P2022` la tabla o la columna no existe. Es lo que pasa cuando el
 * worker arranca con código nuevo antes de que corra `prisma migrate deploy`:
 * falla todo junto y no hay que perder un solo evento.
 */
const SCHEMA_PRISMA_CODES = new Set(['P2021', 'P2022']);

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
 * Clases SQLSTATE de **dato**: el valor no cumple el esquema.
 *
 * `22` son excepciones de datos (valor demasiado largo, mal formado, fuera de
 * rango). Son de ese evento.
 */
const DATA_SQLSTATE_PREFIXES = ['22'];

/**
 * Clases SQLSTATE de **integridad**: el valor no cumple una restricción.
 *
 * `23` cubre la violación de foreign key (`23503`), la de unicidad y la de
 * "falta un valor obligatorio" (`23502`). Las dos primeras son del dato; la
 * tercera puede serlo de una migración, así que va al cubo del esquema.
 */
const SCHEMA_SQLSTATE_PREFIXES = ['42'];
const DATA_SQLSTATES = new Set(['23503', '23505', '23514']);
const SCHEMA_SQLSTATES = new Set(['23502']);

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
  /**
   * De quién es el problema.
   *
   *   - `event` — el dato de ese evento no entra en el esquema (una foreign
   *     key que no existe, un valor demasiado largo). Es de **ese** evento por
   *     naturaleza: aunque fallen 250 seguidos con el mismo código, cada uno
   *     va al dead-letter por separado.
   *   - `store` — el esquema o la configuración de la base. Si falla todo
   *     junto, el problema es de la base y no se pierde nada.
   *   - `unclassified` — nadie sabe.
   */
  scope: 'event' | 'store' | 'unclassified';
}

export function classifyWriteErrorDetailed(error: unknown): WriteFailure {
  const code = codeOf(error);
  const name = nameOf(error);

  if (name === 'PrismaClientValidationError') {
    // El cliente rechazó los datos antes de mandarlos: es el payload.
    return {
      class: 'permanent',
      recognized: true,
      code: 'PrismaClientValidationError',
      scope: 'event',
    };
  }

  if (code !== null) {
    if (DATA_PRISMA_CODES.has(code)) {
      return { class: 'permanent', recognized: true, code, scope: 'event' };
    }
    if (SCHEMA_PRISMA_CODES.has(code)) {
      return { class: 'permanent', recognized: true, code, scope: 'store' };
    }
    if (TRANSIENT_PRISMA_CODES.has(code)) {
      return { class: 'transient', recognized: true, code, scope: 'store' };
    }
    if (TRANSIENT_SOCKET_CODES.has(code)) {
      return { class: 'transient', recognized: true, code, scope: 'store' };
    }
    if (TRANSIENT_SQLSTATES.has(code)) {
      return { class: 'transient', recognized: true, code, scope: 'store' };
    }
    for (const prefix of TRANSIENT_SQLSTATE_PREFIXES) {
      if (code.startsWith(prefix) && /^\d/.test(code)) {
        return { class: 'transient', recognized: true, code, scope: 'store' };
      }
    }
    if (code.length === 5) {
      if (DATA_SQLSTATE_PREFIXES.some((prefix) => code.startsWith(prefix))) {
        // Excepción de datos: el valor no entra en el esquema.
        return { class: 'permanent', recognized: true, code, scope: 'event' };
      }
      if (DATA_SQLSTATES.has(code)) {
        return { class: 'permanent', recognized: true, code, scope: 'event' };
      }
      if (SCHEMA_SQLSTATES.has(code)) {
        return { class: 'permanent', recognized: true, code, scope: 'store' };
      }
      if (SCHEMA_SQLSTATE_PREFIXES.includes(code.slice(0, 2))) {
        return { class: 'permanent', recognized: true, code, scope: 'store' };
      }
      // El resto de la clase 23 son violaciones de integridad por el dato.
      if (code.startsWith('23')) {
        return { class: 'permanent', recognized: true, code, scope: 'event' };
      }
    }
  }

  // Sin clasificación concluyente se reintenta: perder telemetría guardable es
  // peor que retrasarla.
  return { class: 'transient', recognized: false, code, scope: 'unclassified' };
}

/** Decide si un evento que no se pudo guardar es permanente o pasajero. */
export function classifyWriteError(error: unknown): WriteFailureClass {
  return classifyWriteErrorDetailed(error).class;
}
