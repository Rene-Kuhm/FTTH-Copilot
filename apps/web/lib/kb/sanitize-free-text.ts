/**
 * El saneamiento del texto libre de la KB (learning loop, D3 — T1.4).
 *
 * `rootCause`, `fix` y `summary` son texto libre del operador. Hoy entran a
 * la base tal cual y salen del recall como "contexto, no evidencia": un texto
 * con instrucciones embebidas viaja al prompt. Con recall semántico (Fase 2)
 * viajaría **mucho más seguido**: el aprendizaje amplifica el daño de una
 * sola fila mala.
 *
 * Por eso el saneamiento va **al escribir**, no al leer: el embedding se
 * calcula una vez, y si el texto malicioso entra al vector, sanear en lectura
 * llega tarde. Además, al escribir hay un humano responsable: la fila que se
 * marca no se rechaza en silencio, queda `quarantined` y espera revisión
 * humana para entrar a la KB.
 *
 * El módulo es puro: no toca la base, no lee el reloj. La ruta `confirm` y la
 * promoción lo usan antes de persistir.
 */
import { detectInstructionInjection, type InjectionDetection } from '@ftth-copilot/shared';

import { FREE_TEXT_MAX_BYTES } from '../investigations/feedback';

/** El resultado del saneamiento. */
export interface SanitizedFreeText {
  /** El texto limpio: normalizado, sin invisibles y capado. */
  readonly text: string;
  /** ¿El texto cambió al sanearlo? */
  readonly changed: boolean;
  /** ¿El cap de bytes recortó el texto? */
  readonly truncated: boolean;
  /** La instrucción embebida detectada, si hubo. */
  readonly suspicion: InjectionDetection | null;
}

/**
 * Caracteres invisibles y de control que se eliminan.
 *
 * - C0 y C1: controles, salvo el tabulador y el salto de línea;
 * - `U+00AD`: soft hyphen;
 * - `U+200B`–`U+200F`: ancho cero y marcas bidireccionales;
 * - `U+202A`–`U+202E`: incrustación y sobreescritura bidireccional;
 * - `U+2060`–`U+2064`: unir palabras y operadores invisibles;
 * - `U+2066`–`U+2069`: aisladores bidireccionales;
 * - `U+FEFF`: BOM / espacio de no separación de ancho cero;
 * - `U+E0000`–`U+E007F`: etiquetas Unicode, invisibles por definición y
 *   usadas para smugglear texto.
 */
const INVISIBLE_OR_CONTROL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;

/**
 * Normaliza, quita lo invisible y capea por bytes.
 *
 * La detección de instrucciones va **después** de la limpieza: los
 * caracteres de ancho cero no pueden esconder un patrón, sólo lo
 * fragmentan — y limpiarlos lo deja a la vista.
 */
export function sanitizeFreeText(input: string): SanitizedFreeText {
  const original = typeof input === 'string' ? input : '';
  const normalized = original.normalize('NFKC');
  const cleaned = normalized.replace(INVISIBLE_OR_CONTROL, '');
  const clamped = clampToBytes(cleaned, FREE_TEXT_MAX_BYTES);

  return {
    text: clamped.text,
    changed: clamped.text !== original,
    truncated: clamped.truncated,
    suspicion: detectInstructionInjection(clamped.text),
  };
}

/**
 * Recorta por bytes sin partir un caracter.
 *
 * Devuelve el texto y si lo recortó. Un cap de bytes y no de caracteres:
 * el límite es el tamaño de la fila en la base, y un emoji son cuatro
 * bytes.
 */
function clampToBytes(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maxBytes) return { text: value, truncated: false };

  let out = '';
  let used = 0;
  for (const char of value) {
    const size = encoder.encode(char).byteLength;
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return { text: out, truncated: true };
}
