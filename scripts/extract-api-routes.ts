#!/usr/bin/env tsx
/**
 * Inventario de la API HTTP del repo.
 *
 * Uso:
 *   pnpm exec tsx scripts/extract-api-routes.ts            # tabla legible
 *   pnpm exec tsx scripts/extract-api-routes.ts --json     # JSON para máquinas
 *
 * Imprime cada route handler de `apps/web/app/api/**` con su ruta pública y
 * sus métodos. Es la entrada para escribir el contrato OpenAPI y la referencia
 * que el CI compara contra el código.
 */
import path from "node:path";
import { readApiRoutes } from "./lib/api-contract.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function main(): void {
  const routes = readApiRoutes(REPO_ROOT);
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(routes, null, 2)}\n`);
    return;
  }
  const byPath = new Map<string, string[]>();
  for (const route of routes) {
    const methods = byPath.get(route.path) ?? [];
    methods.push(route.method);
    byPath.set(route.path, methods);
  }
  process.stdout.write(`${byPath.size} rutas · ${routes.length} operaciones\n\n`);
  for (const [apiPath, methods] of [...byPath.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    process.stdout.write(`${methods.join(",").padEnd(22)} ${apiPath}\n`);
  }
}

main();
