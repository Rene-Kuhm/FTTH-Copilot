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
  collectMarkdownFiles as collectMarkdownFilesImpl,
  createIgnoreMatcher,
  IGNORED_DIRECTORIES,
} from "./lib/docs-files.ts";
import {
  buildProgram,
  readPackageExports,
  readWorkspaces,
  type Workspace,
} from "./lib/workspace.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

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
  return collectMarkdownFilesImpl(root, createIgnoreMatcher(root));
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

/**
 * `bash -n`: el bloque tiene que ser shell válido.
 *
 * El script entra por stdin, no por un archivo: `bash -n` lee de la entrada
 * estándar cuando no recibe un path, y asi no se crea ningún archivo con un
 * nombre adivinable en el directorio temporal compartido.
 */
function checkBashSyntax(block: CodeBlock): Finding[] {
  const result = spawnSync("bash", ["-n"], {
    encoding: "utf8",
    input: sanitizeShellSnippet(block.code),
  });
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
}

/**
 * El bloque tiene que ser Python válido.
 *
 * Se compila desde stdin (`compile(sys.stdin.read(), ...)`) en lugar de dejar
 * un `.py` en el directorio temporal: no hay archivo que otro usuario pueda
 * anticipar.
 */
function checkPythonSyntax(block: CodeBlock): Finding[] {
  const result = spawnSync(
    "python3",
    ["-c", "import sys; compile(sys.stdin.read(), '<doc-example>', 'exec')"],
    { encoding: "utf8", input: block.code },
  );
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

/**
 * Ejecuta un bloque marcado con `exec` y devuelve el hallazgo si falla.
 *
 * El código va por stdin (`bash` sin argumentos lee el script de la entrada
 * estándar, igual que `tsx` sin argumentos) y corre en un directorio temporal
 * creado con `mkdtemp`, que es único e inaccesible para otros usuarios. No se
 * escribe ningún archivo con un nombre adivinable.
 */
function runExecutableBlock(block: CodeBlock): Finding[] {
  const isTypeScript = classifyBlock(block.language) === "typescript";
  const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-test-"));
  try {
    const command = isTypeScript ? "pnpm" : "bash";
    const args = isTypeScript ? ["exec", "tsx"] : [];
    const result = spawnSync(command, args, {
      encoding: "utf8",
      input: block.code,
      cwd: workingDir,
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
    fs.rmSync(workingDir, { recursive: true, force: true });
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
