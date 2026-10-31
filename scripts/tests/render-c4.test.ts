import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { readLayerNames } from "../render-c4.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const MODEL_PATH = path.join(REPO_ROOT, "docs/architecture/c4/model.d2");

test("readLayerNames encuentra las capas del modelo D2", () => {
  const source = fs.readFileSync(MODEL_PATH, "utf8");
  assert.deepEqual(readLayerNames(source), ["context", "container", "component", "dataflow"]);
});

test("readLayerNames ignora las menciones a `layers:` en los comentarios", () => {
  const source = [
    "# un comentario que dice `layers:` mentirosamente",
    "vars: {",
    "  name: valor",
    "}",
    "layers: {",
    "  primera: {",
    "    a -> b",
    "  }",
    "  segunda: {",
    "    c -> d",
    "  }",
    "}",
  ].join("\n");
  assert.deepEqual(readLayerNames(source), ["primera", "segunda"]);
});

test("readLayerNames falla si el modelo no declara layers", () => {
  assert.throws(() => readLayerNames("vars: {\n  a: 1\n}\n"), /no declara un bloque/);
});
