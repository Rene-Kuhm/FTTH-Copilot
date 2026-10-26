/**
 * Descubrimiento de los módulos del repo: workspaces, capas y superficie pública.
 *
 * Lo comparten `scripts/repo-map.ts` (imprime el esqueleto) y
 * `scripts/docs-test.ts` (verifica que la documentación no invente exports).
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Un módulo del repo: un paquete del workspace o un servicio suelto. */
export interface Workspace {
  /** Ruta relativa al repo. */
  readonly dir: string;
  /** Nombre del paquete (o el nombre de la carpeta, para los servicios). */
  readonly name: string;
  /** Entry point público (ruta relativa al repo) o `null` si no expone uno. */
  readonly entry: string | null;
  /** Dependencias entre módulos del repo. */
  readonly workspaceDeps: string[];
}

/** Expande un glob simple (`apps/*`, `packages/connectors/*`) sin dependencias externas. */
export function expandGlob(root: string, pattern: string): string[] {
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

/** Globs de `pnpm-workspace.yaml`. */
export function readWorkspaceGlobs(root: string): string[] {
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

/** Todos los módulos del repo: paquetes del workspace y servicios. */
export function readWorkspaces(root: string): Workspace[] {
  const dirs = new Set<string>();
  for (const glob of readWorkspaceGlobs(root)) {
    for (const dir of expandGlob(root, glob)) dirs.add(dir);
  }
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

/** Profundidad de cada módulo en el grafo de dependencias (0 = no depende de nadie). */
export function computeLayers(workspaces: readonly Workspace[]): Map<string, number> {
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

/** Programa de TypeScript con los entry points de todos los paquetes del workspace. */
export function buildProgram(root: string, workspaces: readonly Workspace[]): ts.Program {
  const rootNames = workspaces
    .map((workspace) => (workspace.entry ? path.join(root, workspace.entry) : null))
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

/** Nombres exportados por cada paquete del workspace. */
export function readPackageExports(
  root: string,
  program: ts.Program,
  workspaces: readonly Workspace[],
): Map<string, Set<string>> {
  const checker = program.getTypeChecker();
  const exportsByPackage = new Map<string, Set<string>>();
  for (const workspace of workspaces) {
    if (!workspace.entry) continue;
    const sourceFile = program.getSourceFile(path.join(root, workspace.entry));
    if (!sourceFile) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    const names = new Set<string>();
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      names.add(exported.getName());
    }
    exportsByPackage.set(workspace.name, names);
  }
  return exportsByPackage;
}
