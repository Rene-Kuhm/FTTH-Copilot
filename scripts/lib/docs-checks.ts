/**
 * Verificación semántica de los ejemplos de la documentación contra el estado
 * real del repo.
 *
 * Todo lo de este módulo es puro: recibe `RepoFacts` (un snapshot del repo) y
 * devuelve hallazgos. El runner (`scripts/docs-test.ts`) se encarga de leer el
 * repo, construir el snapshot y ejecutar los procesos que hacen falta.
 */
import ts from "typescript";
import { parseAllDocuments } from "yaml";
import type { CodeBlock, CommandInvocation } from "./docs-blocks.ts";
import { classifyBlock, parseShellCommands } from "./docs-blocks.ts";

/** Hallazgo de una verificación. */
export interface Finding {
  readonly severity: "error" | "warning" | "info";
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** Snapshot del repo contra el que se validan los ejemplos. */
export interface RepoFacts {
  /** Scripts del `package.json` raíz. */
  readonly rootScripts: ReadonlySet<string>;
  /** Scripts por paquete del workspace. */
  readonly packageScripts: ReadonlyMap<string, ReadonlySet<string>>;
  /** Directorio de cada paquete del workspace (relativo al repo). */
  readonly packageDirs: ReadonlyMap<string, string>;
  /** Tareas declaradas en `turbo.json`. */
  readonly turboTasks: ReadonlySet<string>;
  /** Tareas declaradas en `mise.toml`. */
  readonly miseTasks: ReadonlySet<string>;
  /** Variables de entorno conocidas (`.env.example` + `turbo.json`). */
  readonly envKeys: ReadonlySet<string>;
  /** Prefijos de las variables de entorno de la app (`METRICS`, `LAYA`, ...). */
  readonly envKeyPrefixes: ReadonlySet<string>;
  /** Símbolos exportados por paquete del workspace. */
  readonly packageExports: ReadonlyMap<string, ReadonlySet<string>>;
  /** Archivos y directorios del repo, relativos a la raíz. */
  readonly existingFiles: ReadonlySet<string>;
  /** Rutas del alias `@/*` de `apps/web` resueltas a archivos del repo. */
  readonly webAliasTargets: ReadonlyMap<string, string>;
  /** ¿La ruta está ignorada por `.gitignore`? */
  readonly isIgnored: (repoRelativePath: string) => boolean;
}

/** Directorios del repo: una ruta que empieza por uno de ellos tiene que existir. */
const REPO_DIRECTORIES = [
  ".github/",
  "apps/",
  "docker/",
  "docs/",
  "openspec/",
  "packages/",
  "research/",
  "scripts/",
  "services/",
];

/** Segmentos de ruta que son salidas generadas: la documentación las puede citar. */
const OUTPUT_SEGMENTS = [
  ".next",
  "build",
  "coverage",
  "dist",
  "generated",
  "out",
  "reports",
  "target",
];

const PNPM_BUILTINS = new Set([
  "add",
  "approve-builds",
  "audit",
  "bin",
  "config",
  "create",
  "deploy",
  "dlx",
  "env",
  "exec",
  "help",
  "i",
  "import",
  "info",
  "install",
  "licenses",
  "link",
  "list",
  "ls",
  "outdated",
  "pack",
  "patch",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "rm",
  "root",
  "run",
  "store",
  "uninstall",
  "unlink",
  "update",
  "version",
  "view",
  "why",
]);

const NPM_BUILTINS = new Set([
  "access",
  "audit",
  "cache",
  "ci",
  "config",
  "create",
  "docs",
  "exec",
  "fund",
  "help",
  "i",
  "info",
  "init",
  "install",
  "link",
  "login",
  "logout",
  "ls",
  "outdated",
  "owner",
  "pack",
  "ping",
  "profile",
  "publish",
  "run",
  "search",
  "start",
  "test",
  "token",
  "uninstall",
  "unlink",
  "update",
  "version",
  "why",
]);

const PNPM_FLAGS_WITH_VALUE = new Set([
  "--filter",
  "-F",
  "--dir",
  "-C",
  "--config",
  "--store-dir",
  "--virtual-store-dir",
  "--reporter",
  "--workspace-concurrency",
  "--lockfile-dir",
]);

const MERMAID_DIAGRAMS = new Set([
  "block-beta",
  "C4Component",
  "C4Container",
  "C4Context",
  "C4Deployment",
  "C4Dynamic",
  "classDiagram",
  "erDiagram",
  "flowchart",
  "gantt",
  "gitGraph",
  "graph",
  "journey",
  "mindmap",
  "pie",
  "quadrantChart",
  "requirementDiagram",
  "sankey-beta",
  "sequenceDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "timeline",
]);

function errorFinding(block: CodeBlock, message: string): Finding {
  return { severity: "error", file: block.file, line: block.line, message };
}

function warningFinding(block: CodeBlock, message: string): Finding {
  return { severity: "warning", file: block.file, line: block.line, message };
}

/** ¿El path es una salida generada que la documentación puede citar? */
export function isOutputPath(candidate: string): boolean {
  const segments = candidate.replace(/^\.\//, "").split("/");
  return segments.some((segment) => OUTPUT_SEGMENTS.includes(segment));
}

/** Verifica que un path del repo exista. `known: false` cuando no se puede afirmar. */
export function checkRepoPath(
  candidate: string,
  facts: RepoFacts,
): { readonly ok: boolean; readonly known: boolean; readonly path: string } {
  const normalized = candidate.replace(/^\.\//, "").replace(/\/+$/, "");
  if (normalized === "") return { ok: true, known: true, path: normalized };
  // URLs, rutas absolutas y expresiones regulares no son paths del repo.
  if (normalized.includes("://") || normalized.startsWith("/")) {
    return { ok: true, known: false, path: normalized };
  }
  if (isOutputPath(normalized)) return { ok: true, known: false, path: normalized };
  if (facts.isIgnored(normalized)) return { ok: true, known: false, path: normalized };
  if (REPO_DIRECTORIES.some((directory) => normalized.startsWith(directory))) {
    // Con globs (`scripts/tests/*.test.ts`) se verifica el directorio, no el archivo.
    if (/[*?[]/.test(normalized)) {
      const base = normalized.split("/").slice(0, -1).join("/");
      if (base === "") return { ok: true, known: false, path: normalized };
      const directory = facts.existingFiles.has(`${base}/`) || facts.existingFiles.has(base);
      return { ok: directory, known: true, path: base };
    }
    return {
      ok:
        facts.existingFiles.has(normalized) ||
        facts.existingFiles.has(`${normalized}/`),
      known: true,
      path: normalized,
    };
  }
  if (!normalized.includes("/")) {
    // Un archivo suelto (por ejemplo `install.sh`) vive en la raíz del repo; si
    // no está en ninguna parte, es un artefacto externo (un `.AppImage`
    // descargado, por ejemplo) y no se puede verificar.
    if (facts.existingFiles.has(normalized)) {
      return { ok: true, known: true, path: normalized };
    }
    return { ok: true, known: false, path: normalized };
  }
  return { ok: true, known: false, path: normalized };
}

interface PnpmInvocation {
  readonly filter: string | undefined;
  readonly recursive: boolean;
  readonly positional: readonly string[];
}

export function parsePnpmArgs(args: readonly string[]): PnpmInvocation {
  let filter: string | undefined;
  let recursive = false;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--filter" || arg === "-F") {
      filter = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--filter=")) {
      filter = arg.slice("--filter=".length);
      continue;
    }
    if (arg === "--recursive" || arg === "-r" || arg === "--workspaces" || arg === "-w") {
      recursive = true;
      continue;
    }
    if (PNPM_FLAGS_WITH_VALUE.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    positional.push(arg);
  }
  return { filter, recursive, positional };
}

/** Nombres de paquete conocidos, para resolver `--filter ./packages/db`. */
function resolveFilter(filter: string, facts: RepoFacts): string | undefined {
  if (facts.packageScripts.has(filter)) return filter;
  const withoutPrefix = filter.replace(/^@ftth-copilot\//, "");
  for (const name of facts.packageScripts.keys()) {
    if (name === `@ftth-copilot/${withoutPrefix}`) return name;
  }
  return undefined;
}

/** Paquete al que apunta el directorio actual del bloque (`cd apps/web`). */
function packageForDir(dir: string, facts: RepoFacts): string | undefined {
  for (const [packageDir, packageName] of facts.packageDirs) {
    if (packageDir === dir) return packageName;
  }
  return undefined;
}

/** Resultado de buscar un script de pnpm en el repo. */
type ScriptStatus = "found" | "elsewhere" | "missing";

function scriptStatus(
  script: string,
  facts: RepoFacts,
  invocation: PnpmInvocation,
  currentDir: string | undefined,
): ScriptStatus {
  if (invocation.filter) {
    const target = resolveFilter(invocation.filter, facts);
    if (!target) return "missing";
    return facts.packageScripts.get(target)?.has(script) ? "found" : "missing";
  }

  const currentPackage = currentDir ? packageForDir(currentDir, facts) : undefined;
  if (currentPackage) {
    if (facts.packageScripts.get(currentPackage)?.has(script)) return "found";
  } else if (facts.rootScripts.has(script)) {
    return "found";
  }

  // El ejemplo puede estar corriendo dentro de un paquete del workspace sin
  // decirlo: el script existe, pero no en el `package.json` raíz.
  for (const scripts of facts.packageScripts.values()) {
    if (scripts.has(script)) return "elsewhere";
  }
  return "missing";
}

function checkPnpm(
  block: CodeBlock,
  invocation: CommandInvocation,
  facts: RepoFacts,
  currentDir: string | undefined,
): Finding[] {
  const findings: Finding[] = [];
  const parsed = parsePnpmArgs(invocation.args);
  const [subcommand = "", ...rest] = parsed.positional;

  if (subcommand === "turbo") {
    const tasks = rest[0] === "run" ? rest.slice(1) : rest;
    for (const task of tasks.filter((token) => !token.startsWith("-"))) {
      if (!facts.turboTasks.has(task)) {
        findings.push(
          errorFinding(block, `\`pnpm turbo run ${task}\`: la tarea "${task}" no existe en turbo.json`),
        );
      }
    }
    return findings;
  }

  if (subcommand === "run") {
    const script = rest[0];
    if (script) {
      const status = scriptStatus(script, facts, parsed, currentDir);
      if (status === "missing") {
        findings.push(errorFinding(block, `\`pnpm run ${script}\`: el script "${script}" no existe`));
      } else if (status === "elsewhere") {
        findings.push(
          warningFinding(
            block,
            `\`pnpm run ${script}\`: el script no está en el package.json raíz (¿falta un \`cd\` al paquete?)`,
          ),
        );
      }
    }
    return findings;
  }

  if (!subcommand) return findings;
  if (PNPM_BUILTINS.has(subcommand)) return findings;
  const status = scriptStatus(subcommand, facts, parsed, currentDir);
  if (status === "missing") {
    const target = parsed.filter ? ` (--filter ${parsed.filter})` : "";
    findings.push(
      errorFinding(block, `\`pnpm ${subcommand}\`${target}: el script "${subcommand}" no existe`),
    );
  } else if (status === "elsewhere") {
    findings.push(
      warningFinding(
        block,
        `\`pnpm ${subcommand}\`: el script no está en el package.json raíz (¿falta un \`cd\` al paquete?)`,
      ),
    );
  }
  return findings;
}

function checkMise(block: CodeBlock, invocation: CommandInvocation, facts: RepoFacts): Finding[] {
  const [subcommand = "", ...rest] = invocation.args;
  if (subcommand !== "run") return [];
  const task = rest.find((token) => !token.startsWith("-"));
  if (!task) return [];
  if (facts.miseTasks.has(task)) return [];
  return [errorFinding(block, `\`mise run ${task}\`: la tarea "${task}" no existe en mise.toml`)];
}

/** Verifica los paths del repo que aparecen como argumentos de un comando. */
function checkPathArguments(
  block: CodeBlock,
  invocation: CommandInvocation,
  facts: RepoFacts,
): Finding[] {
  const findings: Finding[] = [];
  const candidates = [invocation.executable, ...invocation.args];
  for (const candidate of candidates) {
    if (!candidate || candidate.startsWith("-")) continue;
    if (!candidate.includes("/")) continue;
    const result = checkRepoPath(candidate, facts);
    if (!result.known || result.ok) continue;
    findings.push(
      errorFinding(block, `\`${invocation.raw}\`: no existe "${result.path}" en el repo`),
    );
  }
  return findings;
}

export function checkBashBlock(block: CodeBlock, facts: RepoFacts): Finding[] {
  const findings: Finding[] = [];
  let currentDir: string | undefined;
  for (const invocation of parseShellCommands(block.code)) {
    const { executable } = invocation;
    if (executable === "cd") {
      const target = invocation.args[0];
      if (target && !target.startsWith("-")) currentDir = target.replace(/^\.\//, "");
      continue;
    }
    if (executable === "pnpm") {
      findings.push(...checkPnpm(block, invocation, facts, currentDir));
      continue;
    }
    if (executable === "mise") {
      findings.push(...checkMise(block, invocation, facts));
      continue;
    }
    if (executable === "npm") {
      const script = invocation.args.find((token) => !token.startsWith("-"));
      if (script && !NPM_BUILTINS.has(script) && !facts.rootScripts.has(script)) {
        findings.push(errorFinding(block, `\`npm run ${script}\`: el script "${script}" no existe`));
      }
      continue;
    }
    findings.push(...checkPathArguments(block, invocation, facts));
  }
  return findings;
}

interface ModuleReference {
  readonly specifier: string;
  readonly names: readonly string[];
}

/** Importaciones y re-exportaciones declaradas en un bloque TypeScript. */
export function collectModuleReferences(code: string): ModuleReference[] {
  const source = ts.createSourceFile(
    "doc-example.ts",
    code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const references: ModuleReference[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
      const names: string[] = [];
      const clause = statement.importClause;
      if (clause?.name) names.push("default");
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) names.push(element.name.text);
      }
      references.push({ specifier, names });
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
      const names: string[] = [];
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) names.push(element.name.text);
      }
      references.push({ specifier, names });
    }
  }
  return references;
}

/** `parseDiagnostics` es interno del compilador: se tipa explícitamente. */
interface SourceFileWithDiagnostics extends ts.SourceFile {
  readonly parseDiagnostics: readonly ts.Diagnostic[];
}

/**
 * Los ejemplos de la documentación suelen ser fragmentos: un cuerpo de
 * interfaz, un literal de objeto, una firma suelta. Se prueban como está y, si
 * no parsea, dentro de envoltorios que los vuelven sintácticamente válidos.
 */
const TS_WRAPPERS: readonly ((code: string) => string)[] = [
  (code) => code,
  (code) => `(${code})`,
  (code) => `interface __DocExample {\n${code}\n}`,
  (code) => `type __DocExample = ${code};`,
  (code) => `const __DocExample = ${code};`,
];

export function parseTypeScriptSnippet(code: string): string | null {
  for (const wrap of TS_WRAPPERS) {
    const source = ts.createSourceFile(
      "doc-example.ts",
      wrap(code),
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    ) as SourceFileWithDiagnostics;
    if (source.parseDiagnostics.length === 0) return null;
  }
  const source = ts.createSourceFile(
    "doc-example.ts",
    code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  ) as SourceFileWithDiagnostics;
  const first = source.parseDiagnostics[0];
  if (!first) return null;
  return ts.flattenDiagnosticMessageText(first.messageText, " ");
}

export function checkTypeScriptBlock(block: CodeBlock, facts: RepoFacts): Finding[] {
  const findings: Finding[] = [];
  const parseError = parseTypeScriptSnippet(block.code);
  if (parseError) {
    findings.push(errorFinding(block, `TypeScript no compila: ${parseError}`));
  }

  for (const reference of collectModuleReferences(block.code)) {
    const { specifier, names } = reference;
    if (specifier.startsWith("@ftth-copilot/")) {
      const exported = facts.packageExports.get(specifier);
      if (!exported) {
        findings.push(errorFinding(block, `\`${specifier}\` no es un paquete del workspace`));
        continue;
      }
      for (const name of names) {
        if (!exported.has(name)) {
          findings.push(
            errorFinding(
              block,
              `\`${specifier}\` no exporta "${name}" (la documentación está desfasada)`,
            ),
          );
        }
      }
      continue;
    }
    if (specifier.startsWith("@/")) {
      const target = facts.webAliasTargets.get(specifier);
      if (!target) {
        findings.push(
          errorFinding(block, `\`${specifier}\` no resuelve a ningún archivo de apps/web`),
        );
        continue;
      }
      if (!facts.existingFiles.has(target)) {
        findings.push(errorFinding(block, `\`${specifier}\` apunta a "${target}", que no existe`));
      }
      continue;
    }
  }
  return findings;
}

export function checkEnvBlock(block: CodeBlock, facts: RepoFacts): Finding[] {
  const findings: Finding[] = [];
  for (const line of block.code.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    if (!match) continue;
    const key = match[1] ?? "";
    if (facts.envKeys.has(key)) continue;
    const separator = key.indexOf("_");
    const prefix = separator > 0 ? key.slice(0, separator) : key;
    if (facts.envKeyPrefixes.has(prefix)) {
      findings.push(
        errorFinding(
          block,
          `la variable "${key}" no existe: el prefijo "${prefix}" existe, pero esa variable no`,
        ),
      );
      continue;
    }
    findings.push(
      warningFinding(
        block,
        `la variable "${key}" no está en .env.example ni en turbo.json (puede ser de un servicio externo)`,
      ),
    );
  }
  return findings;
}

export function checkMermaidBlock(block: CodeBlock): Finding[] {
  const findings: Finding[] = [];
  const firstLine = block.code.split("\n").find((line) => line.trim().length > 0) ?? "";
  const diagram = firstLine.trim().split(/\s+/)[0] ?? "";
  if (diagram && !MERMAID_DIAGRAMS.has(diagram)) {
    findings.push(warningFinding(block, `tipo de diagrama desconocido: "${diagram}"`));
  }
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ];
  for (const [open, close] of pairs) {
    const opens = block.code.split(open).length - 1;
    const closes = block.code.split(close).length - 1;
    if (opens !== closes) {
      findings.push(
        errorFinding(block, `mermaid desbalanceado: "${open}" (${opens}) vs "${close}" (${closes})`),
      );
    }
  }
  return findings;
}

/** JSON con abreviaturas de documentación (`{ ... }` en lugar de un objeto). */
function normalizeJsonSnippet(code: string): string {
  return code.replace(/\{\s*\.\.\.\s*\}/g, "{}");
}

export function checkJsonBlock(block: CodeBlock): Finding[] {
  try {
    JSON.parse(normalizeJsonSnippet(block.code));
    return [];
  } catch (error) {
    return [errorFinding(block, `JSON inválido: ${(error as Error).message}`)];
  }
}

export function checkYamlBlock(block: CodeBlock): Finding[] {
  const findings: Finding[] = [];
  for (const document of parseAllDocuments(block.code)) {
    for (const error of document.errors) {
      findings.push(errorFinding(block, `YAML inválido: ${error.message}`));
    }
  }
  return findings;
}

/** Verificación de bloque según su tipo. Sin procesos: solo contra el snapshot. */
export function checkBlock(block: CodeBlock, facts: RepoFacts): Finding[] {
  switch (classifyBlock(block.language)) {
    case "bash":
      return checkBashBlock(block, facts);
    case "typescript":
      return checkTypeScriptBlock(block, facts);
    case "json":
      return checkJsonBlock(block);
    case "yaml":
      return checkYamlBlock(block);
    case "env":
      return checkEnvBlock(block, facts);
    case "mermaid":
      return checkMermaidBlock(block);
    default:
      return [];
  }
}
