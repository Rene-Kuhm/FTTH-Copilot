#!/usr/bin/env tsx
/**
 * Renderiza las vistas C4 del modelo D2.
 *
 * Uso:
 *   pnpm c4:render   # escribe los SVG en docs/architecture/c4/views/
 *   pnpm c4:check    # falla si lo commiteado difiere de lo que se renderiza
 *
 * El modelo es `docs/architecture/c4/model.d2`: un único archivo con las tres
 * vistas C4 (Contexto, Contenedores y Componentes) como `layers`. Cada capa se
 * renderiza a su propio SVG con `d2 --target layers.<vista>`.
 *
 * `--check` renderiza en un directorio temporal y compara byte a byte con lo
 * commiteado: no toca el worktree y no depende del estado del índice de git.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MODEL_PATH = path.join(REPO_ROOT, "docs/architecture/c4/model.d2");
const VIEWS_DIR = path.join(REPO_ROOT, "docs/architecture/c4/views");

/**
 * Devuelve los nombres de las capas (`layers: { ... }`) del modelo D2.
 *
 * El archivo D2 no es JSON, pero el bloque `layers` tiene una forma estable:
 * una llave por capa al primer nivel de llaves. Se busca el bloque y se leen
 * las llaves de primer nivel.
 */
export function readLayerNames(source: string): string[] {
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  const start = code.indexOf("layers:");
  if (start === -1) throw new Error("el modelo no declara un bloque `layers:`");
  const open = code.indexOf("{", start);
  if (open === -1) throw new Error("el bloque `layers:` no abre una llave");
  let depth = 0;
  const names: string[] = [];
  let keyStart = open + 1;
  for (let index = open; index < code.length; index += 1) {
    const character = code[index];
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const last = code.slice(keyStart, index).trim();
        if (last !== "") names.push(last);
        return names;
      }
      if (depth === 1) {
        // Se cerró un bloque de una capa: la siguiente llave arranca después.
        keyStart = index + 1;
      }
      continue;
    }
    if (depth === 1 && character === ":") {
      const name = code.slice(keyStart, index).trim();
      if (name !== "") names.push(name);
      keyStart = index + 1;
    }
  }
  throw new Error("el bloque `layers:` no cierra");
}

function runD2(args: readonly string[]): void {
  const result = spawnSync("d2", [...args], { stdio: "inherit" });
  if (result.error) {
    throw new Error(
      `no se pudo ejecutar d2 (${result.error.message}). Instalalo con \`mise install --locked\`.`,
    );
  }
  if (result.status !== 0) throw new Error(`d2 falló con código ${result.status ?? "?"}`);
}

function main(): void {
  const check = process.argv.includes("--check");
  if (!fs.existsSync(MODEL_PATH)) {
    process.stderr.write(`falta el modelo C4: ${path.relative(REPO_ROOT, MODEL_PATH)}\n`);
    process.exit(1);
  }
  const source = fs.readFileSync(MODEL_PATH, "utf8");
  const layers = readLayerNames(source);
  if (layers.length === 0) {
    process.stderr.write("el modelo no declara ninguna vista\n");
    process.exit(1);
  }

  const outputDir = check ? fs.mkdtempSync(path.join(os.tmpdir(), "c4-")) : VIEWS_DIR;
  if (!check) fs.mkdirSync(outputDir, { recursive: true });

  const problems: string[] = [];
  for (const layer of layers) {
    const output = path.join(outputDir, `${layer}.svg`);
    runD2(["--target", `layers.${layer}`, MODEL_PATH, output]);
    if (!check) {
      process.stdout.write(`renderizado docs/architecture/c4/views/${layer}.svg\n`);
      continue;
    }
    const committed = path.join(VIEWS_DIR, `${layer}.svg`);
    if (!fs.existsSync(committed)) {
      problems.push(`falta docs/architecture/c4/views/${layer}.svg`);
      continue;
    }
    const rendered = fs.readFileSync(output);
    const expected = fs.readFileSync(committed);
    if (!rendered.equals(expected)) {
      problems.push(
        `docs/architecture/c4/views/${layer}.svg no coincide con el modelo (render: ${rendered.length} bytes, commiteado: ${expected.length} bytes)`,
      );
    }
  }

  if (check) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    if (problems.length > 0) {
      process.stderr.write("\nLas vistas C4 están desactualizadas respecto del modelo:\n");
      for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
      process.stderr.write("\nRegenerá con `pnpm c4:render` (o `mise run c4:render`).\n");
      process.exit(1);
    }
    process.stdout.write(`vistas C4 al día: ${layers.length} vistas.\n`);
    return;
  }

  process.stdout.write(`vistas C4 renderizadas: ${layers.join(", ")}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
