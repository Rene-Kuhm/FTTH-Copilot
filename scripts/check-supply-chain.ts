/**
 * check-supply-chain — verifica la política de supply chain del repo contra
 * los YAML de `.github/workflows/`.
 *
 * Uso: `pnpm exec tsx scripts/check-supply-chain.ts` (o `node scripts/check-supply-chain.ts`).
 *
 * Es el mismo check que corre el job `supply-chain` del CI: lee sólo los
 * archivos del repo, no instala nada y no habla con la red, así que no puede
 * fallar por causas externas al contenido del pull request.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  checkSupplyChain,
  findUnpinnedCompositeActions,
  type WorkflowFile,
} from "./lib/supply-chain.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const ACTIONS_DIR = path.join(REPO_ROOT, ".github", "actions");

function readWorkflows(directory: string): WorkflowFile[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => ({
      path: `.github/workflows/${name}`,
      content: fs.readFileSync(path.join(directory, name), "utf8"),
    }));
}

/**
 * Las acciones compuestas del repo, en `.github/actions/<nombre>/action.yml`.
 *
 * Referencian acciones de terceros igual que un workflow, así que la regla de
 * SHA pinning les aplica: sin esto, una acción compuesta sería un hueco por
 * el que entra una acción sin fijar.
 */
function readCompositeActions(directory: string): WorkflowFile[] {
  if (!fs.existsSync(directory)) return [];
  const files: WorkflowFile[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const actionDir = path.join(directory, entry.name);
    for (const name of ["action.yml", "action.yaml"]) {
      const file = path.join(actionDir, name);
      if (!fs.existsSync(file)) continue;
      files.push({
        path: `.github/actions/${entry.name}/${name}`,
        content: fs.readFileSync(file, "utf8"),
      });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

const workflows = readWorkflows(WORKFLOWS_DIR);
const compositeActions = readCompositeActions(ACTIONS_DIR);

if (workflows.length === 0) {
  console.error(`No hay workflows en ${WORKFLOWS_DIR}.`);
  process.exit(1);
}

const violations = [
  ...checkSupplyChain(workflows),
  ...findUnpinnedCompositeActions(compositeActions),
];

if (violations.length > 0) {
  for (const violation of violations) {
    const location = violation.line === null ? violation.path : `${violation.path}:${violation.line}`;
    console.error(`::error::${location}: ${violation.message}`);
  }
  console.error(`${violations.length} violaciones de la política de supply chain.`);
  process.exit(1);
}

console.log(
  `Política de supply chain OK: ${workflows.length} workflows y ` +
    `${compositeActions.length} acciones compuestas, todas las acciones fijadas por SHA, ` +
    `todos los jobs con permissions:, y el pipeline de release conectado.`,
);
