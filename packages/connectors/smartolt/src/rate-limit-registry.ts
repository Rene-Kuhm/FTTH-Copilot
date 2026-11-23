/**
 * El presupuesto de la cuenta, compartido entre instancias del cliente.
 *
 * El presupuesto de 1.000 llamadas por hora es de la cuenta, no del objeto que
 * llama. Pero el scheduler construye un conector nuevo en cada tick, así que un
 * guardia por instancia reiniciaba el contador en cada poll: el conector podía
 * pasar el límite de la hora sin que nadie lo notara y, del otro lado, el
 * proveedor contestaba 429.
 *
 * Este registro guarda un guardia (y el contador de cada endpoint con tope
 * propio) por cuenta, así que dos instancias para la misma cuenta gastan el
 * mismo presupuesto. La clave de la cuenta es la URL base más un identificador
 * opaco y aleatorio asignado a la API key dentro del proceso: el mapa vive en memoria del proceso y no tiene por qué tener la
 * credencial en claro como clave.
 *
 * El alcance es el proceso, igual que el guardia que reemplaza: dos procesos
 * (el worker y la web) tienen cada uno su ventana. Compartirla entre procesos
 * requeriría un almacén externo, que hoy no existe y no hace falta: el trabajo
 * de fondo lo corre un solo proceso.
 */
import { randomUUID } from 'node:crypto';
import {
  SmartoltHourlyBudget,
  SmartoltRateGovernor,
  type SmartoltGovernorClock,
  type SmartoltRateLimitConfig,
} from './rate-limit';

/** Lo mínimo para identificar una cuenta de SmartOLT. */
export interface SmartoltAccountIdentity {
  /** URL base de la API (`https://<subdominio>.smartolt.com`). */
  apiBaseUrl: string;
  /** API key de la cuenta. Nunca se guarda ni se loguea. */
  apiKey: string;
}

/**
 * Identificador opaco por API key, solo en memoria del proceso. No se deriva
 * de la credencial (no hay hash que se pueda atacar): la key solo sirve para
 * reconocer que dos instancias son la misma cuenta, y el id que sale de acá es
 * lo único que viaja en las claves de los mapas y en cualquier log.
 */
const ACCOUNT_IDS = new Map<string, string>();

function accountIdFor(apiKey: string): string {
  const known = ACCOUNT_IDS.get(apiKey);
  if (known !== undefined) return known;
  const created = randomUUID();
  ACCOUNT_IDS.set(apiKey, created);
  return created;
}

/**
 * La URL base sin la barra final, para que dos formas de escribirla den la
 * misma cuenta.
 */
function normalizeBaseUrl(raw: string): string {
  try {
    return new URL(raw).toString().replace(/\/$/, '');
  } catch {
    return raw.trim().replace(/\/$/, '');
  }
}

/**
 * La clave de la cuenta: URL base + identificador opaco de la API key.
 *
 * Nunca la key cruda. El identificador distingue dos cuentas del mismo
 * subdominio y no permite recuperar la credencial.
 */
export function smartoltAccountKey(identity: SmartoltAccountIdentity): string {
  return `${normalizeBaseUrl(identity.apiBaseUrl)}#${accountIdFor(identity.apiKey)}`;
}

const GOVERNORS = new Map<string, SmartoltRateGovernor>();
const BUDGETS = new Map<string, SmartoltHourlyBudget>();

/**
 * El guardia de la cuenta, creado la primera vez y reusado después.
 *
 * La configuración es la del primer cliente que la pidió: el presupuesto es de
 * la cuenta, y dos procesos que se contradicen sobre el tope no tienen una
 * respuesta correcta. Un cliente con su propio reloj (los tests, un run
 * determinista) no pasa por acá.
 */
export function getAccountRateGovernor(
  accountKey: string,
  config: SmartoltRateLimitConfig,
  clock: Partial<SmartoltGovernorClock> = {},
): SmartoltRateGovernor {
  const existing = GOVERNORS.get(accountKey);
  if (existing !== undefined) return existing;
  const created = new SmartoltRateGovernor(config, clock);
  GOVERNORS.set(accountKey, created);
  return created;
}

/**
 * El presupuesto por hora de un endpoint de la cuenta (el stream de eventos,
 * por ejemplo), compartido entre las instancias de esa cuenta.
 */
export function getAccountHourlyBudget(
  accountKey: string,
  perHour: number,
  clock: Partial<SmartoltGovernorClock> = {},
): SmartoltHourlyBudget {
  const existing = BUDGETS.get(accountKey);
  if (existing !== undefined) return existing;
  const created = new SmartoltHourlyBudget(perHour, clock);
  BUDGETS.set(accountKey, created);
  return created;
}

/** Sólo para tests: vacía el registro para que cada caso arranque limpio. */
export function __resetSmartoltAccountBudgetsForTests(): void {
  GOVERNORS.clear();
  BUDGETS.clear();
  ACCOUNT_IDS.clear();
}
