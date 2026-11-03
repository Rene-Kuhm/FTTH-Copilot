/**
 * La taxonomía de inyección y el detector de texto con instrucciones.
 *
 * El juego cerrado de superficies y de tipos de inyección es el del contrato
 * de evaluación (`ftth.eval-corpus.v1`). Antes de que este módulo existiera,
 * ese juego cerrado vivía sólo en `packages/eval` — y `packages/eval`
 * depende de Prisma, así que ni el núcleo puro del learning loop ni el
 * paquete de seguridad podían consultarlo. AGENTS.md §4: un tipo duplicado en
 * dos paquetes es un bug, y un tipo que nadie más puede leer también.
 *
 * Por eso la taxonomía vive acá, en `shared`, que es la base del workspace:
 * `packages/eval` la reexporta sin cambiar su API pública, y el saneador de
 * la KB la consulta para clasificar una fila sospechosa.
 *
 * El detector es **puro**: recibe texto y devuelve la familia de patrón que
 * encontró, o `null`. No lee nada, no llama a nadie.
 */
import { z } from 'zod';

/** El juego cerrado de tipos de inyección (7 familias). */
export const INJECTION_KINDS = [
  'direct-override',
  'role-reassignment',
  'customer-name-smuggle',
  'connector-payload-smuggle',
  'retrieval-row-smuggle',
  'prediction-smuggle',
  'system-injection',
] as const;

/** Tipo de inyección. */
export type InjectionKind = (typeof INJECTION_KINDS)[number];

/** El schema zod del juego cerrado. */
export const injectionKindSchema = z.enum(INJECTION_KINDS);

/** ¿El valor es un tipo de inyección del juego cerrado? */
export function isInjectionKind(value: unknown): value is InjectionKind {
  return typeof value === 'string' && (INJECTION_KINDS as readonly string[]).includes(value);
}

/**
 * Las familias que el detector de texto puede reconocer.
 *
 * Son las tres que pueden aparecer dentro de un **texto libre**: una
 * instrucción que anula el contexto, una que reasigna el rol, y una que
 * usa el nombre de un cliente para filtrar un dato. Las otras tres
 * (`connector-payload-smuggle`, `retrieval-row-smuggle`,
 * `prediction-smuggle`) no son familias de texto: son *superficies* — la
 * forma en que el contenido llega. Una fila de la KB que smugglea es
 * `retrieval-row-smuggle` por donde llega, aunque el texto que lleva sea
 * un `direct-override`.
 */
export type DetectableInjectionKind =
  | 'direct-override'
  | 'role-reassignment'
  | 'customer-name-smuggle'
  | 'system-injection';

/** Un hallazgo del detector. */
export interface InjectionDetection {
  /** La familia del patrón que matcheó. */
  readonly kind: DetectableInjectionKind;
  /** El fragmento del texto que matcheó, recortado. */
  readonly evidence: string;
}

/**
 * Normaliza para comparar: minúsculas, sin acentos, sin puntuación.
 *
 * La comparación es deliberadamente tolerante: el texto llega de un
 * operador que escribe a mano, con acentos y mayúsculas; el patrón que
 * importa es el contenido, no la forma.
 */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s<>[\]#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Los patrones de cada familia.
 *
 * Se prueban contra el texto normalizado. El orden importa: el primero que
 * matchea gana, y por eso `system-injection` va último — una etiqueta de
 * sistema que además dice "ignora las instrucciones" es, para el operador,
 * una anulación de contexto.
 */
const PATTERNS: ReadonlyArray<{
  kind: DetectableInjectionKind;
  pattern: RegExp;
}> = [
  {
    kind: 'direct-override',
    pattern:
      /\b(?:ignora|olvida|olvide|desestima|desestimá|ignore|disregard)\b[^.]{0,40}\b(?:instrucciones|instruccion|instructions?|rules?|reglas)\b/,
  },
  {
    kind: 'direct-override',
    pattern: /\b(?:instrucciones|instructions?)\s+(?:anteriores|previas|previous|above)\b/,
  },
  {
    kind: 'role-reassignment',
    pattern:
      /\ba partir de ahora\b[^.]{0,60}\b(?:sos|eres|you are|actua|actua como|act as|vas a ser)\b/,
  },
  {
    kind: 'role-reassignment',
    pattern:
      /\b(?:olvida tu rol|olvidá tu rol|your new role|asistente sin restricciones|unrestricted assistant|without restrictions)\b/,
  },
  {
    kind: 'customer-name-smuggle',
    pattern:
      /\b(?:decile|decí|deciles|dile|dí|revela|revelá|mostra|mostrá|enviale|envíale|tell|reveal|show|send)\b[^.]{0,80}\b(?:contrasena|contraseña|password|clave|secret|credencial|datos personales|personal data)\b/,
  },
  {
    kind: 'system-injection',
    pattern: /<\s*system\s*>|<\s*\/?\s*system\s*>|\[\s*\/?\s*inst\s*\]|###\s*system\b/,
  },
  {
    kind: 'system-injection',
    pattern: /\bsystem\s*:\s*(?:ignore|override|you must|respond)\b/,
  },
];

/** Cuántos caracteres de contexto se conservan alrededor del hallazgo. */
const EVIDENCE_RADIUS = 60;

/**
 * ¿El texto lleva una instrucción embebida?
 *
 * Devuelve el primer patrón que matchea, o `null`. La evidencia sale del
 * texto **normalizado** (minúsculas, sin acentos): es determinista y no
 * depende de indices que el aplanado cambiaría. Lo que se registra en la
 * auditoría de una cuarentena es el patrón detectado, no una cita literal.
 */
export function detectInstructionInjection(text: string): InjectionDetection | null {
  if (!text || typeof text !== 'string') return null;
  const normalized = normalizeForMatch(text);
  if (normalized.length === 0) return null;

  for (const { kind, pattern } of PATTERNS) {
    const match = pattern.exec(normalized);
    if (!match) continue;
    const start = Math.max(0, match.index - EVIDENCE_RADIUS);
    const end = Math.min(normalized.length, match.index + match[0].length + EVIDENCE_RADIUS);
    return { kind, evidence: normalized.slice(start, end).trim() };
  }

  return null;
}
