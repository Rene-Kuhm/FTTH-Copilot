import assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeBlock } from "../lib/docs-blocks.ts";
import {
  checkBashBlock,
  checkEnvBlock,
  checkJsonBlock,
  checkTypeScriptBlock,
  checkYamlBlock,
  parsePnpmArgs,
  type RepoFacts,
} from "../lib/docs-checks.ts";

function block(language: string, code: string, line = 10): CodeBlock {
  return {
    file: "docs/ejemplo.md",
    line,
    language,
    attributes: [],
    code,
    closed: true,
  };
}

const facts: RepoFacts = {
  rootScripts: new Set(["build", "lint", "test", "db:deploy"]),
  packageScripts: new Map([
    ["@ftth-copilot/web", new Set(["build", "dev", "tauri:build", "build:static"])],
    ["@ftth-copilot/db", new Set(["db:generate", "db:seed"])],
  ]),
  packageDirs: new Map([
    ["apps/web", "@ftth-copilot/web"],
    ["packages/db", "@ftth-copilot/db"],
  ]),
  turboTasks: new Set(["build", "lint", "test", "typecheck"]),
  miseTasks: new Set(["build", "lint", "test", "docs-test", "repo-map"]),
  envKeys: new Set(["METRICS_POLLER_ENABLED", "LAYA_MODE", "JWT_SECRET"]),
  envKeyPrefixes: new Set(["METRICS", "LAYA", "JWT"]),
  packageExports: new Map([
    ["@ftth-copilot/shared", new Set(["TelemetryEvent", "AgentResult"])],
  ]),
  existingFiles: new Set([
    "README.md",
    "apps/web/",
    "apps/web/src/index.ts",
    "scripts/run-demo.sh",
    "packages/db/",
  ]),
  webAliasTargets: new Map([["@/lib/auth/server", "apps/web/lib/auth/server.ts"]]),
  isIgnored: (repoRelativePath) => repoRelativePath.startsWith("apps/web/dist/"),
};

test("parsePnpmArgs separa filtro, recursividad y posicionales", () => {
  assert.deepEqual(parsePnpmArgs(["--filter", "@ftth-copilot/web", "test:e2e"]), {
    filter: "@ftth-copilot/web",
    recursive: false,
    positional: ["test:e2e"],
  });
  assert.deepEqual(parsePnpmArgs(["-r", "test"]), {
    filter: undefined,
    recursive: true,
    positional: ["test"],
  });
});

test("checkBashBlock acepta un script que existe", () => {
  const findings = checkBashBlock(block("bash", "pnpm build\npnpm lint"), facts);
  assert.deepEqual(findings, []);
});

test("checkBashBlock detecta un script de pnpm que no existe", () => {
  const findings = checkBashBlock(block("bash", "pnpm buidl"), facts);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "error");
  assert.match(findings[0]?.message ?? "", /"buidl" no existe/);
});

test("checkBashBlock detecta una tarea de turbo que no existe", () => {
  const findings = checkBashBlock(block("bash", "pnpm turbo run lint typecheck"), facts);
  assert.deepEqual(findings, []);
  const missing = checkBashBlock(block("bash", "pnpm turbo run lnt"), facts);
  assert.equal(missing.length, 1);
  assert.match(missing[0]?.message ?? "", /turbo\.json/);
});

test("checkBashBlock detecta una tarea de mise que no existe", () => {
  assert.deepEqual(checkBashBlock(block("bash", "mise run repo-map"), facts), []);
  const findings = checkBashBlock(block("bash", "mise run repo-maps"), facts);
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? "", /mise\.toml/);
});

test("checkBashBlock resuelve el script contra el paquete del `cd`", () => {
  assert.deepEqual(
    checkBashBlock(block("bash", "cd apps/web\npnpm tauri:build"), facts),
    [],
  );
});

test("checkBashBlock avisa cuando el script vive en otro paquete", () => {
  const findings = checkBashBlock(block("bash", "pnpm tauri:build"), facts);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warning");
});

test("checkBashBlock detecta un archivo del repo que no existe", () => {
  const findings = checkBashBlock(block("bash", "./scripts/no-existe.sh"), facts);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "error");
});

test("checkBashBlock acepta un archivo del repo que existe", () => {
  assert.deepEqual(checkBashBlock(block("bash", "./scripts/run-demo.sh"), facts), []);
});

test("checkBashBlock ignora las salidas generadas y lo ignorado por git", () => {
  assert.deepEqual(
    checkBashBlock(block("bash", "cat apps/web/dist/index.html"), facts),
    [],
  );
});

test("checkTypeScriptBlock acepta un export real del workspace", () => {
  const findings = checkTypeScriptBlock(
    block("ts", "import { type TelemetryEvent } from '@ftth-copilot/shared';"),
    facts,
  );
  assert.deepEqual(findings, []);
});

test("checkTypeScriptBlock detecta un export que ya no existe", () => {
  const findings = checkTypeScriptBlock(
    block("ts", "import { type TelemetryEventV2 } from '@ftth-copilot/shared';"),
    facts,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "error");
  assert.match(findings[0]?.message ?? "", /no exporta "TelemetryEventV2"/);
});

test("checkTypeScriptBlock acepta fragmentos de interface y de objeto", () => {
  assert.deepEqual(checkTypeScriptBlock(block("ts", "id: string;\nnombre: string;"), facts), []);
  assert.deepEqual(checkTypeScriptBlock(block("ts", "{ vendor: 'acme', display: 'ACME' }"), facts), []);
});

test("checkTypeScriptBlock detecta TypeScript roto de verdad", () => {
  const findings = checkTypeScriptBlock(block("ts", "const x = ;"), facts);
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? "", /TypeScript no compila/);
});

test("checkEnvBlock da error si la variable pertenece a la app y no existe", () => {
  const findings = checkEnvBlock(block("env", "METRICS_POLLER=true"), facts);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "error");
});

test("checkEnvBlock avisa si la variable es de un servicio externo", () => {
  const findings = checkEnvBlock(block("env", "NEXTAUTH_URL=https://x"), facts);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warning");
});

test("checkJsonBlock valida JSON y tolera la abreviatura `{ ... }`", () => {
  assert.deepEqual(checkJsonBlock(block("json", '{"a": 1}')), []);
  assert.deepEqual(checkJsonBlock(block("json", '{"data": { ... }}')), []);
  assert.equal(checkJsonBlock(block("json", '{"a": }')).length, 1);
});

test("checkYamlBlock valida YAML", () => {
  assert.deepEqual(checkYamlBlock(block("yaml", "a: 1\nb: [1, 2]\n")), []);
  const broken = checkYamlBlock(block("yaml", "a: 1\n  b: 2\n"));
  assert.ok(broken.length >= 1);
  assert.equal(broken[0]?.severity, "error");
});
