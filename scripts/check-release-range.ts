/**
 * check-release-range — verifica que el changelog de la release en curso no
 * repita trabajo ya publicado.
 *
 * Uso: `pnpm check:release-range` (o `node scripts/check-release-range.ts`).
 *
 * release-please arma el changelog de la release en curso con los commits
 * que encuentra entre la línea base (`last-release-sha`) y HEAD. Si la línea
 * base apunta a un commit más viejo que el último release publicado, la
 * release nueva repite las entradas del release anterior y arrastra notas
 * que ya se publicaron (un `BREAKING CHANGE:` de un commit viejo, por
 * ejemplo).
 *
 * El check lee el CHANGELOG.md que se va a publicar y la línea base del
 * config, y falla si alguna entrada de la sección más reciente ya estaba
 * publicada. Corre en el CI de todos los pull requests, así que el pull
 * request de release es el primero que ve el changelog repetido.
 *
 * Necesita el historial completo del repo: con un clon superficial la
 * comprobación no puede resolver los ancestros y el check lo dice en vez de
 * dar un veredicto equivocado.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { findReleaseRangeViolations, parseChangelog } from "./lib/release-range.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function isAncestor(ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
  console.error(
    "El clon es superficial: el check necesita el historial completo para resolver los ancestros. " +
      "En CI, hacé el checkout con `fetch-depth: 0`.",
  );
  process.exit(1);
}

const config = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "release-please-config.json"), "utf8"),
) as { "last-release-sha"?: string };

const changelog = fs.readFileSync(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");
const sections = parseChangelog(changelog);

if (sections.length === 0) {
  console.error("El CHANGELOG.md no tiene ninguna sección de versión.");
  process.exit(1);
}

const violations = findReleaseRangeViolations({
  sections,
  base: config["last-release-sha"],
  head: git(["rev-parse", "HEAD"]),
  isAncestor,
});

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`::error::CHANGELOG.md: ${violation}`);
  }
  console.error(
    `${violations.length} violaciones del rango del changelog. ` +
      `La línea base (last-release-sha) tiene que apuntar al commit del último release publicado.`,
  );
  process.exit(1);
}

console.log(
  `Rango del changelog OK: la sección ${sections[0].version} tiene ${sections[0].entries.length} entradas ` +
    `y ninguna repite un release ya publicado.`,
);
