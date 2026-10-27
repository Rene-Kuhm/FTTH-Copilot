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
import { checkSupplyChain, type WorkflowFile } from "./lib/supply-chain.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");

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

const workflows = readWorkflows(WORKFLOWS_DIR);

if (workflows.length === 0) {
  console.error(`No hay workflows en ${WORKFLOWS_DIR}.`);
  process.exit(1);
}

const violations = checkSupplyChain(workflows);

if (violations.length > 0) {
  for (const violation of violations) {
    const location = violation.line === null ? violation.path : `${violation.path}:${violation.line}`;
    console.error(`::error::${location}: ${violation.message}`);
  }
  console.error(`${violations.length} violaciones de la política de supply chain.`);
  process.exit(1);
}

console.log(
  `Política de supply chain OK: ${workflows.length} workflows, todas las acciones fijadas por SHA, ` +
    `todos los jobs con permissions:, los scripts de Windows con shell: explícito, ` +
    `y el pipeline de release conectado.`,
);
