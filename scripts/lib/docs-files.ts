/**
 * Descubrimiento de los archivos Markdown que entra en la verificación.
 *
 * Vive en `lib/` y no en `scripts/docs-test.ts` para que sea testeable: el
 * bug que arregla (escandir documentación que `.gitignore` ignora) sólo se
 * puede verificar si la función es importable.
 *
 * La regla que importa: **`docs-test` tiene que ver lo mismo que ve el CI.**
 * El CI hace un checkout limpio, así que un directorio generado y ignorado
 * por git (`docs/api/`, `docs/assets/`) no existe ahí. Si la herramienta
 * local lo escanea, el resultado local y el del CI divergen: la doc
 * generada se verifica contra el código sin que nadie la haya commiteado, y
 * un ejemplo roto en un artefacto local hace fallar un gate que en CI está
 * en verde.
 */
import fs from "node:fs";
import path from "node:path";

/** Directorios que nunca se recorren (build, dependencias, salidas generadas). */
export const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "generated",
]);

/**
 * Centinela para `**` mientras se escapa el patrón.
 *
 * Es un carácter que un `.gitignore` no puede contener, así que no puede
 * colisionar con el texto del patrón.
 */
const DOUBLE_STAR = String.fromCharCode(0);

/** Convierte un patrón de `.gitignore` en una expresión regular. */
export function ignorePatternToRegExp(pattern: string): RegExp {
  let value = pattern;
  let anchored = false;
  if (value.startsWith("/")) {
    anchored = true;
    value = value.slice(1);
  }
  if (value.endsWith("/")) value = `${value}**`;
  const escaped = value
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, "[^/]*")
    .split(DOUBLE_STAR)
    .join(".*")
    .replace(/\?/g, "[^/]");
  return anchored ? new RegExp(`^${escaped}$`) : new RegExp(`(^|/)${escaped}($|/)`);
}

/**
 * ¿La ruta está ignorada por algún `.gitignore` del repo?
 *
 * Cada `.gitignore` manda sobre su propio directorio: el patrón `*` de
 * `.atl/.gitignore` ignora lo que hay adentro de `.atl`, no el repo entero.
 *
 * `repoRelativePath` usa `/` como separador, relativo a la raíz del repo.
 */
export function createIgnoreMatcher(
  root: string,
): (repoRelativePath: string) => boolean {
  const matchers: { base: string; pattern: RegExp }[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.name !== ".gitignore") continue;
      const base = path.relative(root, dir).replaceAll(path.sep, "/");
      for (const line of fs.readFileSync(full, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
        matchers.push({ base, pattern: ignorePatternToRegExp(trimmed) });
      }
    }
  };
  walk(root);
  return (repoRelativePath: string) =>
    matchers.some(({ base, pattern }) => {
      if (base === "") return pattern.test(repoRelativePath);
      if (!repoRelativePath.startsWith(`${base}/`)) return false;
      return pattern.test(repoRelativePath.slice(base.length + 1));
    });
}

/**
 * Archivos Markdown que entran en la verificación.
 *
 * `isIgnored` recibe la ruta relativa al repo, con `/` como separador.
 */
export function collectMarkdownFiles(
  root: string,
  isIgnored: (repoRelativePath: string) => boolean = () => false,
): string[] {
  const files: string[] = [];
  const relative = (file: string): string =>
    path.relative(root, file).replaceAll(path.sep, "/");

  const readme = path.join(root, "README.md");
  if (fs.existsSync(readme) && !isIgnored("README.md")) files.push(readme);

  const docsDir = path.join(root, "docs");
  if (fs.existsSync(docsDir)) {
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".md")) continue;
        if (isIgnored(relative(full))) continue;
        files.push(full);
      }
    };
    walk(docsDir);
  }

  // Los `AGENTS.md` son documentación dirigida a agentes: sus comandos también
  // tienen que existir.
  const walkAgents = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        walkAgents(path.join(dir, entry.name));
        continue;
      }
      if (entry.name !== "AGENTS.md") continue;
      const full = path.join(dir, entry.name);
      if (isIgnored(relative(full))) continue;
      files.push(full);
    }
  };
  walkAgents(root);

  return [...new Set(files)];
}
