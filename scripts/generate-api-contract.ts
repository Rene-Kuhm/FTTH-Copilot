#!/usr/bin/env tsx
/**
 * Genera (o verifica) los artefactos derivados del contrato OpenAPI.
 *
 * Uso:
 *   pnpm contract:generate   # escribe los artefactos
 *   pnpm contract:check      # falla si lo commiteado no coincide con el contrato
 *
 * Qué verifica `--check`:
 *   1. Que `docs/reference/api-http.md`, los tipos y los esquemas Zod sean
 *      exactamente lo que produce el generador con el contrato actual.
 *   2. Que toda ruta implementada en `apps/web/app/api/**` esté declarada en
 *      el contrato, y viceversa. Sin esto, el contrato podría quedarse viejo
 *      en silencio.
 *
 * Es un check hermético: sólo lee archivos del repo y escribe nada.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  generateReference,
  generateSchemas,
  generateTypes,
  parseContract,
  type Contract,
} from "./lib/api-contract-generator.ts";
import { compareRoutesToContract, readApiRoutes } from "./lib/api-contract.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CONTRACT_PATH = path.join(REPO_ROOT, "docs/contract/openapi.yaml");

/** Un artefacto generado y dónde vive. */
interface Artifact {
  readonly path: string;
  readonly content: string;
}

function buildArtifacts(contract: Contract): Artifact[] {
  return [
    {
      path: path.join(REPO_ROOT, "packages/api-contract/src/generated/types.ts"),
      content: generateTypes(contract),
    },
    {
      path: path.join(REPO_ROOT, "packages/api-contract/src/generated/schemas.ts"),
      content: generateSchemas(contract),
    },
    {
      path: path.join(REPO_ROOT, "docs/reference/api-http.md"),
      content: generateReference(contract),
    },
  ];
}

function relative(file: string): string {
  return path.relative(REPO_ROOT, file).replaceAll(path.sep, "/");
}

function main(): void {
  const check = process.argv.includes("--check");
  if (!fs.existsSync(CONTRACT_PATH)) {
    process.stderr.write(`falta el contrato: ${relative(CONTRACT_PATH)}\n`);
    process.exit(1);
  }

  const contract = parseContract(fs.readFileSync(CONTRACT_PATH, "utf8"));
  const artifacts = buildArtifacts(contract);
  const problems: string[] = [];

  for (const artifact of artifacts) {
    const current = fs.existsSync(artifact.path)
      ? fs.readFileSync(artifact.path, "utf8")
      : null;
    if (current === artifact.content) continue;
    if (current === null) {
      if (!check) {
        fs.mkdirSync(path.dirname(artifact.path), { recursive: true });
        fs.writeFileSync(artifact.path, artifact.content, "utf8");
        process.stdout.write(`escrito ${relative(artifact.path)}\n`);
        continue;
      }
      problems.push(`${relative(artifact.path)} no existe (hay que generarlo)`);
      continue;
    }
    if (!check) {
      fs.mkdirSync(path.dirname(artifact.path), { recursive: true });
      fs.writeFileSync(artifact.path, artifact.content, "utf8");
      process.stdout.write(`escrito ${relative(artifact.path)}\n`);
      continue;
    }
    problems.push(`${relative(artifact.path)} está desactualizado respecto del contrato`);
    const currentLines = current.split("\n");
    const nextLines = artifact.content.split("\n");
    let shown = 0;
    for (let index = 0; index < Math.max(currentLines.length, nextLines.length); index += 1) {
      if (currentLines[index] === nextLines[index]) continue;
      process.stderr.write(
        `  ${relative(artifact.path)}:${index + 1}\n    - ${currentLines[index] ?? ""}\n    + ${nextLines[index] ?? ""}\n`,
      );
      shown += 1;
      if (shown >= 20) {
        process.stderr.write("  … (más diferencias omitidas)\n");
        break;
      }
    }
  }

  const routes = readApiRoutes(REPO_ROOT);
  const parity = compareRoutesToContract(
    routes,
    contract.operations.map((operation) => ({
      method: operation.method as "GET",
      path: operation.path,
    })),
  );
  for (const entry of parity.missingInContract) {
    problems.push(`la ruta ${entry} existe en el código y no está en el contrato`);
  }
  for (const entry of parity.missingInCode) {
    problems.push(`el contrato declara ${entry} y no existe en el código`);
  }

  if (problems.length > 0) {
    process.stderr.write("\nEl contrato y el repo no están en sync:\n");
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.stderr.write(
      "\nRegenerá con `pnpm contract:generate` (o `mise run contract:generate`).\n",
    );
    process.exit(1);
  }

  if (check) {
    process.stdout.write(
      `contrato al día: ${contract.operations.length} operaciones, ${artifacts.length} artefactos.\n`,
    );
  } else {
    process.stdout.write(
      `contrato verificado: ${contract.operations.length} operaciones, ${routes.length} rutas en el código.\n`,
    );
  }
}

main();
