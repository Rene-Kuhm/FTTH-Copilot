import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyBlock,
  extractCodeBlocks,
  parseShellCommands,
  stripShellComment,
  tokenizeShell,
} from "../lib/docs-blocks.ts";

test("extractCodeBlocks encuentra cercas con lenguaje y atributos", () => {
  const markdown = [
    "# Título",
    "",
    "```bash exec",
    "pnpm test",
    "```",
    "",
    "texto",
    "",
    "```ts",
    "export const x = 1;",
    "```",
  ].join("\n");

  const blocks = extractCodeBlocks("README.md", markdown);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.language, "bash");
  assert.deepEqual(blocks[0]?.attributes, ["exec"]);
  assert.equal(blocks[0]?.code, "pnpm test");
  assert.equal(blocks[0]?.line, 3);
  assert.equal(blocks[1]?.language, "ts");
  assert.deepEqual(blocks[1]?.attributes, []);
});

test("extractCodeBlocks soporta cercas de tilde y detecta las sin cerrar", () => {
  const markdown = ["~~~json", "{}", "~~~", "", "```yaml", "a: 1"].join("\n");
  const blocks = extractCodeBlocks("docs/x.md", markdown);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.language, "json");
  assert.equal(blocks[0]?.closed, true);
  assert.equal(blocks[1]?.language, "yaml");
  assert.equal(blocks[1]?.closed, false);
});

test("classifyBlock normaliza los alias de lenguaje", () => {
  assert.equal(classifyBlock("bash"), "bash");
  assert.equal(classifyBlock("sh"), "bash");
  assert.equal(classifyBlock("console"), "bash");
  assert.equal(classifyBlock("ts"), "typescript");
  assert.equal(classifyBlock("TypeScript"), "typescript");
  assert.equal(classifyBlock("yml"), "yaml");
  assert.equal(classifyBlock("dotenv"), "env");
  assert.equal(classifyBlock("mermaid"), "mermaid");
  assert.equal(classifyBlock("text"), "informational");
  assert.equal(classifyBlock(""), "informational");
});

test("tokenizeShell respeta comillas", () => {
  assert.deepEqual(tokenizeShell(`curl -H "a: b" 'c d'`), ["curl", "-H", "a: b", "c d"]);
  assert.deepEqual(tokenizeShell("  spaced   out  "), ["spaced", "out"]);
});

test("stripShellComment no toca los # dentro de comillas", () => {
  assert.equal(stripShellComment("echo hi # comment"), "echo hi ");
  assert.equal(stripShellComment("echo '# not a comment'"), "echo '# not a comment'");
  assert.equal(stripShellComment("url=http://x/#frag"), "url=http://x/#frag");
});

test("parseShellCommands une continuaciones y separa operadores", () => {
  const code = [
    "# comentario",
    "pnpm install \\",
    "  --frozen-lockfile",
    "cd apps/web && pnpm build",
    "curl -s http://x | head -5",
    "FOO=bar pnpm test",
  ].join("\n");

  const invocations = parseShellCommands(code);
  const executables = invocations.map((invocation) => invocation.executable);
  assert.deepEqual(executables, ["pnpm", "cd", "pnpm", "curl", "head", "pnpm"]);
  assert.deepEqual(invocations[0]?.args, ["install", "--frozen-lockfile"]);
  assert.deepEqual(invocations[4]?.args, ["-5"]);
  assert.deepEqual(invocations[5]?.args, ["test"]);
});

test("parseShellCommands ignora las líneas vacías y los comentarios", () => {
  assert.deepEqual(parseShellCommands("\n\n# nada\n   \n"), []);
});
