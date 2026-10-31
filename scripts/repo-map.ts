/**
 * repo-map — imprime el esqueleto del repo para agentes.
 *
 * Uso: `mise run repo-map` (o `pnpm exec tsx scripts/repo-map.ts [--budget 8000]`).
 *
 * Qué imprime:
 *   - los módulos del repo, con su capa y sus dependencias entre módulos;
 *   - los símbolos exportados por cada módulo, con su firma y su tipo;
 *   - nada de implementación: solo la superficie pública.
 *
 * Qué NO imprime: cuerpos de funciones, cuerpos de clase, comentarios, tests,
 * stories de Storybook ni assets.
 *
 * El presupuesto de tokens es un tope duro (`--budget`, 8000 por defecto): si el
 * repo crece, el mapa se recorta y lo dice, en lugar de desbordar la ventana de
 * contexto del agente que lo consume.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_BUDGET = 8000;

/** Estimador de tokens: 4 caracteres por token es el promedio habitual de código. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Workspace {
  /** Ruta relativa al repo. */
  readonly dir: string;
  readonly name: string;
  /** Entry point público (ruta relativa al repo) o `null` si el módulo no expone uno. */
  readonly entry: string | null;
  /** Dependencias entre módulos del repo (nombre de paquete). */
  readonly workspaceDeps: string[];
}

interface ModuleFacts {
  readonly workspace: Workspace;
  /** Profundidad en el grafo de dependencias (0 = no depende de nadie). */
  readonly layer: number;
  /** Archivos que componen la superficie pública del módulo. */
  readonly publicFiles: string[];
  /** Símbolos exportados, ya renderizados como una línea cada uno. */
  readonly symbols: string[];
  /** Módulos re-exportados con `export *` (no se repiten sus símbolos). */
  readonly starReexports: string[];
  /** Resumen extra del módulo (rutas HTTP del app, por ejemplo). */
  readonly extra: string[];
}

/** Expande los globs de `pnpm-workspace.yaml` sin depender de un matcher externo. */
function expandGlob(root: string, pattern: string): string[] {
  let candidates = [root];
  for (const segment of pattern.split("/")) {
    if (segment === "*") {
      candidates = candidates.flatMap((dir) => {
        if (!fs.existsSync(dir)) return [];
        return fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => path.join(dir, entry.name));
      });
    } else {
      candidates = candidates.map((dir) => path.join(dir, segment));
    }
  }
  return candidates.filter((dir) => fs.existsSync(path.join(dir, "package.json")));
}

function readWorkspaceGlobs(root: string): string[] {
  const workspaceFile = path.join(root, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspaceFile)) return [];
  const raw = fs.readFileSync(workspaceFile, "utf8");
  const block = raw.match(/^packages:\s*$([\s\S]*?)(?=^\S|\Z)/m)?.[1] ?? "";
  const globs: string[] = [];
  for (const match of block.matchAll(/^\s*-\s*["']?([^"'#\n]+?)["']?\s*$/gm)) {
    const pattern = match[1]?.trim();
    if (pattern) globs.push(pattern);
  }
  return globs;
}

function readWorkspaces(root: string): Workspace[] {
  const dirs = new Set<string>();
  for (const glob of readWorkspaceGlobs(root)) {
    for (const dir of expandGlob(root, glob)) dirs.add(dir);
  }
  // Los servicios no son paquetes npm, pero forman parte del esqueleto del repo.
  const servicesDir = path.join(root, "services");
  if (fs.existsSync(servicesDir)) {
    for (const entry of fs.readdirSync(servicesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        dirs.add(path.join(servicesDir, entry.name));
      }
    }
  }

  const workspaces: Workspace[] = [];
  for (const dir of [...dirs].sort()) {
    const pkgFile = path.join(dir, "package.json");
    const pkg = fs.existsSync(pkgFile)
      ? (JSON.parse(fs.readFileSync(pkgFile, "utf8")) as Record<string, unknown>)
      : {};
    const name = typeof pkg.name === "string" ? pkg.name : path.basename(dir);
    const exportsField = pkg.exports;
    let entry: string | null = null;
    if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
      const rootExport = (exportsField as Record<string, unknown>)["."];
      if (typeof rootExport === "string") entry = rootExport;
      else if (rootExport && typeof rootExport === "object") {
        const importEntry = (rootExport as Record<string, unknown>).import;
        if (typeof importEntry === "string") entry = importEntry;
      }
    }
    if (!entry && typeof pkg.main === "string" && pkg.main.endsWith(".ts")) {
      entry = pkg.main;
    }
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    workspaces.push({
      dir: path.relative(root, dir).replaceAll(path.sep, "/"),
      name,
      entry: entry ? path.relative(root, path.join(dir, entry)).replaceAll(path.sep, "/") : null,
      workspaceDeps: Object.keys(deps).filter((dep) => dep.startsWith("@ftth-copilot/")),
    });
  }
  return workspaces;
}

/** Calcula la profundidad de cada módulo a partir del grafo de dependencias. */
function computeLayers(workspaces: Workspace[]): Map<string, number> {
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const layers = new Map<string, number>();
  const visit = (name: string, seen: Set<string>): number => {
    const cached = layers.get(name);
    if (cached !== undefined) return cached;
    if (seen.has(name)) return 0;
    seen.add(name);
    let layer = 0;
    for (const dep of byName.get(name)?.workspaceDeps ?? []) {
      if (!byName.has(dep)) continue;
      layer = Math.max(layer, visit(dep, seen) + 1);
    }
    seen.delete(name);
    layers.set(name, layer);
    return layer;
  };
  for (const workspace of workspaces) visit(workspace.name, new Set());
  return layers;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}

/** Quita el ruido de `exactOptionalPropertyTypes` (`T | undefined` → `T`). */
function compactTypes(text: string): string {
  return text.replace(/\s*\|\s*undefined/g, "");
}

function renderSignature(checker: ts.TypeChecker, declaration: ts.SignatureDeclaration): string {
  const signature = checker.getSignatureFromDeclaration(declaration);
  if (!signature) return "()";
  return compactTypes(
    checker.signatureToString(
      signature,
      undefined,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowStyleSignature,
    ),
  );
}

function renderType(checker: ts.TypeChecker, type: ts.Type, max: number): string {
  const text = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  return truncate(compactTypes(text), max);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;
}

const TYPE_MAX = 90;
const INTERFACE_MAX = 150;

/**
 * Renderiza un símbolo exportado como una línea de esqueleto.
 * Devuelve `null` cuando el símbolo no aporta información de superficie.
 */
function renderExportedSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
): { readonly line: string; readonly starReexport: string | null } | null {
  const declaration = symbol.declarations?.[0];
  if (!declaration) return null;

  if (declaration.parent && ts.isExportDeclaration(declaration.parent)) {
    const exportDeclaration = declaration.parent;
    if (!exportDeclaration.exportClause) {
      // `export * from '...'` — el módulo se menciona aparte, sin repetir símbolos.
      return {
        line: "",
        starReexport: exportDeclaration.moduleSpecifier?.getText() ?? "?",
      };
    }
  }

  if (ts.isFunctionDeclaration(declaration)) {
    const async = hasModifier(declaration, ts.SyntaxKind.AsyncKeyword) ? "async " : "";
    return {
      line: `${async}function ${symbol.getName()}${renderSignature(checker, declaration)}`,
      starReexport: null,
    };
  }

  if (ts.isClassDeclaration(declaration)) {
    const heritage = declaration.heritageClauses
      ?.map((clause) => clause.getText().replace(/\s+/g, " "))
      .join(" ");
    return {
      line: `class ${symbol.getName()}${heritage ? ` ${heritage}` : ""}`,
      starReexport: null,
    };
  }

  if (ts.isInterfaceDeclaration(declaration)) {
    const type = checker.getTypeAtLocation(declaration);
    const members = checker.getPropertiesOfType(type).map((member) => {
      const optional = member.flags & ts.SymbolFlags.Optional ? "?" : "";
      const memberDeclaration = member.declarations?.[0];
      const memberType = memberDeclaration
        ? checker.getTypeOfSymbolAtLocation(member, memberDeclaration)
        : undefined;
      return `${member.getName()}${optional}: ${memberType ? renderType(checker, memberType, 50) : "?"}`;
    });
    const body = members.length > 0 ? `{ ${members.join("; ")} }` : "{}";
    return {
      line: `interface ${symbol.getName()} ${truncate(body, INTERFACE_MAX)}`,
      starReexport: null,
    };
  }

  if (ts.isTypeAliasDeclaration(declaration)) {
    return {
      line: `type ${symbol.getName()} = ${truncate(compactTypes(declaration.type.getText()), TYPE_MAX)}`,
      starReexport: null,
    };
  }

  if (ts.isEnumDeclaration(declaration)) {
    const members = declaration.members.map((member) => member.name.getText());
    return { line: `enum ${symbol.getName()} { ${members.join(", ")} }`, starReexport: null };
  }

  if (ts.isVariableDeclaration(declaration)) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    return {
      line: `const ${symbol.getName()}: ${renderType(checker, type, TYPE_MAX)}`,
      starReexport: null,
    };
  }

  // Alias de re-export explícito: se resuelve al símbolo de origen.
  if (symbol.flags & ts.SymbolFlags.Alias) {
    const aliased = checker.getAliasedSymbol(symbol);
    if (aliased && aliased !== symbol) {
      const rendered = renderExportedSymbol(checker, aliased);
      if (rendered?.line) return { line: rendered.line, starReexport: null };
    }
  }

  return null;
}

function collectModuleSymbols(
  checker: ts.TypeChecker,
  program: ts.Program,
  workspace: Workspace,
): { symbols: string[]; starReexports: string[]; publicFiles: string[] } {
  const empty = { symbols: [] as string[], starReexports: [] as string[], publicFiles: [] as string[] };
  if (!workspace.entry) return empty;
  const entryFile = path.join(REPO_ROOT, workspace.entry);
  if (!fs.existsSync(entryFile)) return empty;

  const sourceFile = program.getSourceFile(entryFile);
  if (!sourceFile) return empty;
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return empty;

  const rendered: { name: string; line: string; kind: number }[] = [];
  const starReexports = new Set<string>();
  const publicFiles = new Set<string>([workspace.entry]);

  /** El cliente Prisma generado no es parte del esqueleto: son ~50 tipos repetidos. */
  const isGenerated = (fileName: string): boolean =>
    fileName.includes(`${path.sep}generated${path.sep}`);

  /** La declaración efectiva de un símbolo, resolviendo los alias de re-export. */
  const resolveDeclaration = (symbol: ts.Symbol): ts.Declaration | undefined => {
    const declaration = symbol.declarations?.[0];
    if (!declaration) return undefined;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      const aliased = checker.getAliasedSymbol(symbol);
      if (aliased && aliased !== symbol) return aliased.declarations?.[0];
    }
    return declaration;
  };

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const effective = resolveDeclaration(exported);
    if (effective && isGenerated(effective.getSourceFile().fileName)) continue;
    const result = renderExportedSymbol(checker, exported);
    if (!result) continue;
    if (result.starReexport) {
      const modulePath = result.starReexport.replace(/['"]/g, "");
      const resolved = path.resolve(path.dirname(entryFile), modulePath);
      if (!isGenerated(resolved)) starReexports.add(result.starReexport);
      continue;
    }
    const declaration = effective;
    if (declaration) {
      const file = declaration.getSourceFile().fileName;
      if (file.startsWith(REPO_ROOT) && !isGenerated(file)) {
        publicFiles.add(path.relative(REPO_ROOT, file).replaceAll(path.sep, "/"));
      }
    }
    rendered.push({
      name: exported.getName(),
      line: result.line,
      kind:
        exported.flags & ts.SymbolFlags.Function
          ? 0
          : exported.flags & ts.SymbolFlags.Class
            ? 1
            : 2,
    });
  }

  rendered.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind - b.kind));
  return {
    symbols: rendered.map((entry) => entry.line),
    starReexports: [...starReexports].sort(),
    publicFiles: [...publicFiles].sort(),
  };
}

/** Superficie pública de los servicios Python (no entran al programa de TypeScript). */
function collectPythonSymbols(workspace: Workspace): string[] {
  const dir = path.join(REPO_ROOT, workspace.dir);
  if (!fs.existsSync(dir)) return [];
  const symbols: string[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".py")) continue;
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    for (const match of raw.matchAll(/^(?:async\s+)?(def|class)\s+(\w+)\s*(\([^)]*\))?/gm)) {
      const kind = match[1] === "class" ? "class" : "def";
      symbols.push(`${kind} ${match[2]}${match[3] ?? "()"}`);
    }
  }
  return symbols;
}

/** Resumen de rutas HTTP del App Router, agrupado por segmento de primer nivel. */
function collectRouteGroups(workspace: Workspace): string[] {
  const appDir = path.join(REPO_ROOT, workspace.dir, "app");
  if (!fs.existsSync(appDir)) return [];
  const groups = new Map<string, number>();
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      if (entry.name === "page.tsx" || entry.name === "route.ts") {
        const key = prefix.includes("/") ? `${prefix.split("/")[0]}/*` : prefix || "/";
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
    }
  };
  walk(appDir, "");
  return [...groups.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([group, count]) => `rutas ${group} (${count})`);
}

function buildProgram(workspaces: Workspace[]): ts.Program {
  const rootNames = workspaces
    .map((workspace) => (workspace.entry ? path.join(REPO_ROOT, workspace.entry) : null))
    .filter((file): file is string => file !== null);
  return ts.createProgram(rootNames, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    types: [],
  });
}

function render(facts: ModuleFacts[], quotas: number[]): string {
  const lines: string[] = [];
  const push = (line: string): void => {
    lines.push(line);
  };

  push("# FTTH-Copilot — repo map");
  push(
    `Generado por scripts/repo-map.ts · ${facts.length} módulos · ` +
      `${facts.reduce((total, fact) => total + fact.symbols.length, 0)} símbolos · sin implementación`,
  );
  push("");

  push("## Capas (profundidad del grafo de dependencias)");
  const maxLayer = Math.max(...facts.map((fact) => fact.layer));
  for (let layer = maxLayer; layer >= 0; layer--) {
    const inLayer = facts
      .filter((fact) => fact.layer === layer)
      .map((fact) => fact.workspace.dir)
      .sort();
    push(`L${layer} ${inLayer.join(", ")}`);
  }
  push("");

  facts.forEach((fact, index) => {
    push(`## ${fact.workspace.dir} — ${fact.workspace.name}`);
    push(`deps: ${fact.workspace.workspaceDeps.join(", ") || "(ninguno)"}`);
    for (const extra of fact.extra) push(extra);
    if (fact.publicFiles.length > 0) push(`api: ${fact.publicFiles.join(", ")}`);
    if (fact.starReexports.length > 0) push(`re-exporta *: ${fact.starReexports.join(", ")}`);

    let used = 0;
    let printed = 0;
    for (const symbol of fact.symbols) {
      const cost = estimateTokens(`  ${symbol}\n`);
      if (used + cost > (quotas[index] ?? 0)) break;
      push(`  ${symbol}`);
      used += cost;
      printed += 1;
    }
    const omitted = fact.symbols.length - printed;
    if (omitted > 0) {
      const where = fact.workspace.entry ?? fact.workspace.dir;
      push(`  … +${omitted} símbolos más (ver ${where})`);
    }
    push("");
  });

  return lines.join("\n");
}

function main(): void {
  const budgetArgIndex = process.argv.indexOf("--budget");
  const budget =
    budgetArgIndex >= 0 ? Number(process.argv[budgetArgIndex + 1]) : DEFAULT_BUDGET;
  if (!Number.isFinite(budget) || budget <= 0) {
    console.error("--budget debe ser un número positivo de tokens.");
    process.exit(2);
  }

  const workspaces = readWorkspaces(REPO_ROOT);
  const layers = computeLayers(workspaces);
  const program = buildProgram(workspaces);
  const checker = program.getTypeChecker();

  const facts: ModuleFacts[] = workspaces.map((workspace) => {
    const collected = collectModuleSymbols(checker, program, workspace);
    const symbols = workspace.entry
      ? collected.symbols
      : collectPythonSymbols(workspace);
    const extra = workspace.entry ? [] : collectRouteGroups(workspace);
    return {
      workspace,
      layer: layers.get(workspace.name) ?? 0,
      publicFiles: collected.publicFiles,
      symbols,
      starReexports: collected.starReexports,
      extra,
    };
  });

  facts.sort((a, b) => b.layer - a.layer || a.workspace.dir.localeCompare(b.workspace.dir));

  const totalSymbols = facts.reduce((total, fact) => total + fact.symbols.length, 0);
  // Reserva para encabezados: se mide renderizando sin símbolos.
  const fixedCost = estimateTokens(render(facts, facts.map(() => 0)));
  const symbolBudget = Math.max(0, budget - fixedCost);

  let quotas = facts.map((fact) =>
    Math.floor((symbolBudget * fact.symbols.length) / Math.max(1, totalSymbols)),
  );

  let output = render(facts, quotas);
  for (let attempt = 0; attempt < 8 && estimateTokens(output) > budget; attempt++) {
    const overage = estimateTokens(output) - budget;
    const shrink = Math.max(0.9, 1 - overage / Math.max(1, estimateTokens(output)));
    quotas = quotas.map((quota) => Math.floor(quota * shrink));
    output = render(facts, quotas);
  }

  const tokens = estimateTokens(output);
  process.stdout.write(`${output}\n`);
  process.stderr.write(
    `repo-map: ${tokens} tokens (presupuesto ${budget}) · ${facts.length} módulos · ` +
      `${facts.reduce((total, fact) => total + fact.symbols.length, 0)} símbolos públicos\n`,
  );
  if (tokens > budget) {
    process.stderr.write(
      "repo-map: el mapa excede el presupuesto; bajá --budget o dividí el repo en más módulos.\n",
    );
    process.exit(1);
  }
}

main();
