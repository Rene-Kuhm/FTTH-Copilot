import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectMarkdownFiles, createIgnoreMatcher } from "../lib/docs-files.ts";

/**
 * Monta un repo mínimo en un directorio temporal.
 *
 * `files` es un mapa de ruta relativa → contenido. Las carpetas se crean solas.
 */
function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-files-"));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return root;
}

test("collectMarkdownFiles no entra a los directorios que .gitignore ignora", () => {
  const root = makeRepo({
    ".gitignore": "docs/api/\n",
    "README.md": "# Raíz\n",
    "docs/real.md": "# Real\n",
    "docs/api/README.md": "# Generado\n",
  });

  const isIgnored = createIgnoreMatcher(root);
  const files = collectMarkdownFiles(root, isIgnored);
  const relative = files.map((file) => path.relative(root, file).replaceAll(path.sep, "/"));

  assert.ok(relative.includes("README.md"), "el README de la raíz entra");
  assert.ok(relative.includes("docs/real.md"), "la doc versionada entra");
  assert.ok(
    !relative.includes("docs/api/README.md"),
    "la doc generada e ignorada por git no entra",
  );
});

test("collectMarkdownFiles ignora un archivo suelto ignorado por .gitignore", () => {
  const root = makeRepo({
    ".gitignore": "docs/assets/\n",
    "docs/assets/launch.md": "# Generado\n",
    "docs/keep.md": "# Versionado\n",
  });

  const isIgnored = createIgnoreMatcher(root);
  const files = collectMarkdownFiles(root, isIgnored);
  const relative = files.map((file) => path.relative(root, file).replaceAll(path.sep, "/"));

  assert.ok(relative.includes("docs/keep.md"));
  assert.ok(!relative.includes("docs/assets/launch.md"));
});

test("collectMarkdownFiles incluye los AGENTS.md de los paquetes", () => {
  const root = makeRepo({
    ".gitignore": "",
    "packages/web/AGENTS.md": "# Módulo\n",
  });

  const isIgnored = createIgnoreMatcher(root);
  const files = collectMarkdownFiles(root, isIgnored);
  const relative = files.map((file) => path.relative(root, file).replaceAll(path.sep, "/"));

  assert.ok(relative.includes("packages/web/AGENTS.md"));
});

test("createIgnoreMatcher respeta el .gitignore del subdirectorio que lo declara", () => {
  const root = makeRepo({
    ".gitignore": "*.log\n",
    "packages/web/.gitignore": "local/\n",
    "packages/web/local/x.md": "# Local\n",
    "packages/other/local/x.md": "# De otro paquete\n",
  });

  const isIgnored = createIgnoreMatcher(root);

  assert.equal(isIgnored("packages/web/local/x.md"), true);
  assert.equal(isIgnored("packages/other/local/x.md"), false);
  assert.equal(isIgnored("debug.log"), true);
  assert.equal(isIgnored("docs/real.md"), false);
});
