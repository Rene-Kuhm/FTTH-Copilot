/**
 * docs-test — verifica la documentación contra el código real.
 *
 * Uso: `mise run docs-test` (o `pnpm exec tsx scripts/docs-test.ts`).
 *
 * Qué hace:
 *   1. Extrae los bloques de código de `README.md` y de `docs/**\/*.md`.
 *   2. Verifica cada bloque contra el estado real del repo: scripts de
 *      `package.json`, tareas de `turbo.json` y de `mise.toml`, archivos que el
 *      ejemplo da por existentes, exports de los paquetes del workspace,
 *      variables de entorno, y sintaxis (bash, TypeScript, JSON, YAML).
 *   3. Ejecuta de verdad los bloques marcados con el atributo `exec`.
 *
 * Salida: un error por bloque roto y exit code 1 si hay alguno. Un ejemplo
 * roto no se mergea.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { extractCodeBlocks, classifyBlock, parseShellCommands, type CodeBlock } from "./lib/docs-blocks.ts";
import { checkBlock, type Finding, type RepoFacts } from "./lib/docs-checks.ts";
import {
  buildProgram,
  readPackageExports,
  readWorkspaces,
  type Workspace,
} from "./lib/workspace.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "generated",
]);

interface Options {
  readonly root: string;
  readonly verbose: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  let root = REPO_ROOT;
  let verbose = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      root = path.resolve(argv[index + 1] ?? REPO_ROOT);
      index += 1;
      continue;
    }
    if (arg === "--verbose" || arg === "-v") verbose = true;
  }
  return { root, verbose };
}

/** Archivos Markdown que entran en la verificación. */
function collectMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  const readme = path.join(root, "README.md");
  if (fs.existsSync(readme)) files.push(readme);

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
        if (entry.name.endsWith(".md")) files.push(full);
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
      if (entry.name === "AGENTS.md") files.push(path.join(dir, entry.name));
    }
  };
  walkAgents(root);

  return [...new Set(files)];
}

/** Todos los archivos y directorios del repo, relativos a la raíz. */
function collectRepoFiles(root: string): Set<string> {
  const files = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).replaceAll(path.sep, "/");
      if (entry.isDirectory()) {
        files.add(`${relative}/`);
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        walk(full);
        continue;
      }
      files.add(relative);
    }
  };
  walk(root);
  return files;
}

/** Convierte un patrón de `.gitignore` en una expresión regular. */
function ignorePatternToRegExp(pattern: string): RegExp {
  let value = pattern;
  let anchored = false;
  if (value.startsWith("/")) {
    anchored = true;
    value = value.slice(1);
  }
  if (value.endsWith("/")) value = `${value}**`;
  const escaped = value
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, "[^/]");
  return anchored ? new RegExp(`^${escaped}$`) : new RegExp(`(^|/)${escaped}($|/)`);
}

/**
 * ¿La ruta está ignorada por algún `.gitignore` del repo?
 *
 * Cada `.gitignore` manda sobre su propio directorio: el patrón `*` de
 * `.atl/.gitignore` ignora lo que hay adentro de `.atl`, no el repo entero.
 */
function createIgnoreMatcher(root: string): (repoRelativePath: string) => boolean {
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

function readJsonFile<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** Tareas declaradas en `mise.toml` (`[tasks.<nombre>]`, con comillas opcionales). */
function readMiseTasks(root: string): Set<string> {
  const tasks = new Set<string>();
  const file = path.join(root, "mise.toml");
  if (!fs.existsSync(file)) return tasks;
  const raw = fs.readFileSync(file, "utf8");
  for (const match of raw.matchAll(/^\[tasks\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]/gm)) {
    const task = match[1] ?? match[2];
    if (task) tasks.add(task);
  }
  return tasks;
}

function buildRepoFacts(root: string, workspaces: readonly Workspace[]): RepoFacts {
  const rootPkg = readJsonFile<Record<string, unknown>>(
    path.join(root, "package.json"),
  ) ?? {};
  const rootScripts = new Set(Object.keys((rootPkg.scripts as object) ?? {}));

  const packageScripts = new Map<string, Set<string>>();
  const packageDirs = new Map<string, string>();
  for (const workspace of workspaces) {
    const pkg = readJsonFile<Record<string, unknown>>(
      path.join(root, workspace.dir, "package.json"),
    );
    if (!pkg) continue;
    packageScripts.set(workspace.name, new Set(Object.keys((pkg.scripts as object) ?? {})));
    packageDirs.set(workspace.dir, workspace.name);
  }

  const turbo = readJsonFile<{ tasks?: Record<string, unknown>; globalEnv?: string[] }>(
    path.join(root, "turbo.json"),
  ) ?? {};
  const turboTasks = new Set(Object.keys(turbo.tasks ?? {}));

  const envKeys = new Set<string>(turbo.globalEnv ?? []);
  const envExample = path.join(root, ".env.example");
  if (fs.existsSync(envExample)) {
    for (const line of fs.readFileSync(envExample, "utf8").split("\n")) {
      const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
      if (match?.[1]) envKeys.add(match[1]);
    }
  }
  const envKeyPrefixes = new Set<string>();
  for (const key of envKeys) {
    const separator = key.indexOf("_");
    envKeyPrefixes.add(separator > 0 ? key.slice(0, separator) : key);
  }

  const existingFiles = collectRepoFiles(root);

  // Alias `@/*` de apps/web → archivo del repo.
  const webAliasTargets = new Map<string, string>();
  for (const file of existingFiles) {
    if (!file.startsWith("apps/web/")) continue;
    const rest = file.slice("apps/web/".length).replace(/\.(tsx?|jsx?)$/, "");
    webAliasTargets.set(`@/${rest}`, file);
  }

  const program = buildProgram(root, workspaces);
  const packageExports = readPackageExports(root, program, workspaces);

  return {
    rootScripts,
    packageScripts,
    packageDirs,
    turboTasks,
    miseTasks: readMiseTasks(root),
    envKeys,
    envKeyPrefixes,
    packageExports,
    existingFiles,
    webAliasTargets,
    isIgnored: createIgnoreMatcher(root),
  };
}

/**
 * Los ejemplos de la documentación usan placeholders (`<tenantId>`, `<tu-recurso>`)
 * que no son shell válido. Se sustituyen antes de parsear.
 */
export function sanitizeShellSnippet(code: string): string {
  return code
    .replace(/<[^<>\s][^<>\n]*>/g, "PLACEHOLDER")
    .replace(/\{\{[^}\n]*\}\}/g, "PLACEHOLDER");
}

/** `bash -n`: el bloque tiene que ser shell válido. */
function checkBashSyntax(block: CodeBlock): Finding[] {
  const file = path.join(os.tmpdir(), `docs-test-${process.pid}-${block.line}.sh`);
  try {
    fs.writeFileSync(file, sanitizeShellSnippet(block.code));
    const result = spawnSync("bash", ["-n", file], { encoding: "utf8" });
    if (result.error) return [];
    if (result.status !== 0) {
      return [
        {
          severity: "error",
          file: block.file,
          line: block.line,
          message: `bash no parsea el bloque: ${(result.stderr ?? "").trim()}`,
        },
      ];
    }
    return [];
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** `python -m py_compile`: el bloque tiene que ser Python válido. */
function checkPythonSyntax(block: CodeBlock): Finding[] {
  const file = path.join(os.tmpdir(), `docs-test-${process.pid}-${block.line}.py`);
  try {
    fs.writeFileSync(file, block.code);
    const result = spawnSync("python3", ["-m", "py_compile", file], { encoding: "utf8" });
    if (result.error) return [];
    if (result.status !== 0) {
      return [
        {
          severity: "error",
          file: block.file,
          line: block.line,
          message: `python no compila el bloque: ${(result.stderr ?? "").trim()}`,
        },
      ];
    }
    return [];
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}c`, { force: true });
  }
}

/**
 * Comandos que se pueden ejecutar en un entorno hermético sin efectos: solo
 * piden la versión de una herramienta que el propio repo garantiza.
 */
const HERMETIC_READ_ONLY = /^(node|pnpm|npm)\s+(--version|-v|--help)$/;

/** ¿El bloque solo contiene consultas de versión, sin efectos? */
export function isHermeticReadOnlyBlock(block: CodeBlock): boolean {
  const invocations = parseShellCommands(block.code);
  if (invocations.length === 0) return false;
  return invocations.every((invocation) => HERMETIC_READ_ONLY.test(invocation.raw.trim()));
}

/** Ejecuta un bloque marcado con `exec` y devuelve el hallazgo si falla. */
function runExecutableBlock(block: CodeBlock): Finding[] {
  const isTypeScript = classifyBlock(block.language) === "typescript";
  const file = path.join(
    os.tmpdir(),
    `docs-test-${process.pid}-${block.line}.${isTypeScript ? "ts" : "sh"}`,
  );
  try {
    fs.writeFileSync(file, block.code);
    const command = isTypeScript ? "pnpm" : "bash";
    const args = isTypeScript
      ? ["exec", "tsx", file]
      : [file];
    const result = spawnSync(command, args, {
      encoding: "utf8",
      cwd: path.dirname(file),
      timeout: 120_000,
      env: { ...process.env, CI: "1" },
    });
    if (result.error) {
      return [
        {
          severity: "error",
          file: block.file,
          line: block.line,
          message: `no se pudo ejecutar el bloque: ${result.error.message}`,
        },
      ];
    }
    if (result.status !== 0) {
      return [
        {
          severity: "error",
          file: block.file,
          line: block.line,
          message: `el bloque falló (exit ${result.status}): ${(result.stderr ?? "").trim()}`,
        },
      ];
    }
    return [];
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const files = collectMarkdownFiles(options.root);
  const workspaces = readWorkspaces(options.root);
  const facts = buildRepoFacts(options.root, workspaces);

  const findings: Finding[] = [];
  const stats = { blocks: 0, executed: 0, checked: 0, skipped: 0 };

  for (const file of files) {
    const relative = path.relative(options.root, file).replaceAll(path.sep, "/");
    const content = fs.readFileSync(file, "utf8");
    for (const block of extractCodeBlocks(relative, content)) {
      stats.blocks += 1;
      if (!block.closed) {
        findings.push({
          severity: "error",
          file: block.file,
          line: block.line,
          message: "la cerca de código no cierra",
        });
        continue;
      }
      const kind = classifyBlock(block.language);
      if (kind === "informational") {
        stats.skipped += 1;
        continue;
      }
      stats.checked += 1;
      findings.push(...checkBlock(block, facts));

      if (kind === "bash") findings.push(...checkBashSyntax(block));
      if (kind === "python") findings.push(...checkPythonSyntax(block));

      if (block.attributes.includes("exec") || isHermeticReadOnlyBlock(block)) {
        stats.executed += 1;
        findings.push(...runExecutableBlock(block));
      }
    }
  }

  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");

  for (const finding of findings) {
    const label = finding.severity === "error" ? "ERROR" : "WARN ";
    process.stderr.write(`${label} ${finding.file}:${finding.line} — ${finding.message}\n`);
  }

  process.stdout.write(
    `docs-test: ${stats.blocks} bloques en ${files.length} archivos · ` +
      `${stats.checked} verificados · ${stats.executed} ejecutados · ` +
      `${stats.skipped} informativos · ${errors.length} errores · ${warnings.length} avisos\n`,
  );

  if (errors.length > 0) {
    process.stderr.write("docs-test: hay ejemplos desfasados. Corregí la documentación.\n");
    process.exit(1);
  }
  if (options.verbose) {
    process.stdout.write("docs-test: todo en verde.\n");
  }
}

main();
