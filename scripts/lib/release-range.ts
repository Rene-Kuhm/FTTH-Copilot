/**
 * La línea base del changelog de release-please.
 *
 * release-please arma el changelog de la release en curso con los commits
 * que encuentra entre la línea base y HEAD. La línea base es el
 * `last-release-sha` de `release-please-config.json`, con la excepción de
 * que release-please también sabe resolver por su cuenta los releases que
 * él mismo creó (los publica con el SHA del commit en `target_commitish`).
 *
 * Si la línea base apunta a un commit más viejo que el último release
 * publicado, la release nueva repite las entradas del release anterior y
 * arrastra notas que ya se publicaron. Passó en la 0.4.0: la línea base
 * apuntaba al commit de `v0.2.2` mientras `v0.3.0` ya estaba publicado, así
 * que el changelog de la 0.4.0 repitió las entradas de la 0.3.0 y arrastró
 * un `BREAKING CHANGE:` de un commit de septiembre.
 *
 * Las reglas de este módulo miran el CHANGELOG.md que se va a publicar y la
 * línea base declarada por el config:
 *
 *   1. Todo commit que aparece en la sección más reciente del changelog tiene
 *      que estar dentro del rango [línea base, HEAD]. Si uno está antes, la
 *      sección repite trabajo ya publicado.
 *   2. La sección más reciente no puede repetir una entrada de la sección
 *      anterior: dos releases consecutivos no cuentan el mismo cambio.
 *
 * La lógica es pura: recibe los commits ya resueltos y un predicado
 * `isAncestor`, así que los tests no necesitan un repositorio de verdad.
 */

export interface ChangelogEntry {
  /** Texto de la entrada, sin los links a pull request ni a commit. */
  text: string;
  /** SHA del commit de la entrada, si la entrada tiene link al commit. */
  commit?: string;
}

export interface ChangelogSection {
  /** Versión de la sección, por ejemplo "0.4.0". */
  version: string;
  entries: ChangelogEntry[];
}

export interface ReleaseRangeInput {
  /** Secciones del CHANGELOG.md, de la más reciente a la más antigua. */
  sections: ChangelogSection[];
  /** `last-release-sha` de `release-please-config.json`, si está declarado. */
  base?: string;
  /** Commit contra el que se mide el final del rango. */
  head: string;
  /** Responde si `ancestor` es ancestro de `descendant` (o el mismo commit). */
  isAncestor: (ancestor: string, descendant: string) => boolean;
}

const SECTION_HEADING = /^##\s+\[?(\d+\.\d+\.\d+)\]?/;
const ENTRY_LINE = /^\s*[*-]\s+(.+)$/;
const COMMIT_LINK = /commit\/([0-9a-f]{40})/;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;

/**
 * Normaliza el texto de una entrada para comparar dos entradas que dicen lo
 * mismo con links distintos: se quitan los links, las marcas de énfasis y los
 * espacios sobrantes.
 */
export function normalizeEntryText(text: string): string {
  return text
    .replace(MARKDOWN_LINK, '$1')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parte el CHANGELOG.md en sus secciones de versión, de la más reciente a la
 * más antigua, con las entradas de cada una.
 */
export function parseChangelog(markdown: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      sections.push({ version: heading[1], entries: [] });
      continue;
    }
    const current = sections[sections.length - 1];
    if (!current) continue;
    const entry = ENTRY_LINE.exec(line);
    if (!entry) continue;
    current.entries.push({
      text: normalizeEntryText(entry[1]),
      commit: COMMIT_LINK.exec(entry[1])?.[1],
    });
  }

  return sections;
}

/**
 * Devuelve las violaciones del rango del changelog. Cada violation es un
 * texto que explica qué hay que corregir.
 */
export function findReleaseRangeViolations(input: ReleaseRangeInput): string[] {
  const violations: string[] = [];
  const latest = input.sections[0];
  if (!latest) return violations;

  if (input.base) {
    if (!input.isAncestor(input.base, input.head)) {
      violations.push(
        `last-release-sha ${input.base} no es ancestro de HEAD (${input.head}): el rango del changelog no cubre la historia actual`,
      );
    }

    for (const entry of latest.entries) {
      if (!entry.commit) continue;
      if (!input.isAncestor(input.base, entry.commit)) {
        violations.push(
          `la entrada "${entry.text}" (commit ${entry.commit}) es anterior a la línea base ${input.base}: ya estaba publicada en un release anterior`,
        );
      }
    }
  }

  const previous = input.sections[1];
  if (previous) {
    const published = new Set(previous.entries.map((entry) => entry.text));
    for (const entry of latest.entries) {
      if (published.has(entry.text)) {
        violations.push(
          `la entrada "${entry.text}" repite una entrada ya publicada en la versión ${previous.version}`,
        );
      }
    }
  }

  return violations;
}
