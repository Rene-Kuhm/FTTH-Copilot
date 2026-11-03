import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  VERSION_CARRIERS,
  findVersionMismatches,
  readCarrierVersion,
  syncCarriers,
  writeCarrierVersion,
  type VersionCarrier,
} from "../lib/version-carriers.ts";

/** El carrier de una ruta, o un fallo del test. */
function carrierAt(carrierPath: string): VersionCarrier {
  const carrier = VERSION_CARRIERS.find((candidate) => candidate.path === carrierPath);
  assert.notEqual(carrier, undefined, `no está el carrier ${carrierPath}`);
  return carrier as VersionCarrier;
}

const SYNC_OWNED = [
  "apps/web/android/app/build.gradle",
  "apps/web/app/api/health/route.ts",
  "packages/agent-core/src/telemetry/exporter.ts",
  "packages/learning/src/version.ts",
];

test("la lista de carriers tiene los cuatro que el pipeline sincroniza a mano", () => {
  const owned = VERSION_CARRIERS.filter((carrier) => carrier.owner === "sync").map((c) => c.path);

  assert.deepEqual(owned, SYNC_OWNED);
});

test("readCarrierVersion lee la versión de cada carrier", () => {
  const samples: Record<string, string> = {
    "apps/web/android/app/build.gradle": '        versionName "0.4.0"\n',
    "apps/web/app/api/health/route.ts": "      version: process.env['npm_package_version'] ?? '0.4.0',\n",
    "packages/agent-core/src/telemetry/exporter.ts": "              version: '0.4.0',\n",
    "packages/learning/src/version.ts": "export const LEARNING_CODE_VERSION = '0.4.0';\n",
  };

  for (const carrier of VERSION_CARRIERS.filter((c) => c.owner === "sync")) {
    const content = samples[carrier.path];
    assert.notEqual(content, undefined, `falta la muestra de ${carrier.path}`);
    assert.equal(readCarrierVersion(content as string, carrier), "0.4.0", carrier.path);
  }
});

test("writeCarrierVersion reemplaza la versión sin tocar el resto", () => {
  const carrier = carrierAt("packages/learning/src/version.ts");

  const content = "export const LEARNING_CODE_VERSION = '0.4.0';\n";
  const updated = writeCarrierVersion(content, carrier, "0.5.0");

  assert.equal(updated, "export const LEARNING_CODE_VERSION = '0.5.0';\n");
});

test("writeCarrierVersion no inventa una versión si el patrón no aparece", () => {
  const carrier = carrierAt("packages/learning/src/version.ts");

  const content = "export const OTRA_COSA = '0.4.0';\n";

  assert.equal(writeCarrierVersion(content, carrier, "0.5.0"), content);
});

test("syncCarriers actualiza los carriers que existen y saltea los que no", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carriers-"));
  try {
    const gradle = path.join(root, "apps/web/android/app/build.gradle");
    fs.mkdirSync(path.dirname(gradle), { recursive: true });
    fs.writeFileSync(gradle, '        versionName "0.4.0"\n');

    const learning = path.join(root, "packages/learning/src/version.ts");
    fs.mkdirSync(path.dirname(learning), { recursive: true });
    fs.writeFileSync(learning, "export const LEARNING_CODE_VERSION = '0.4.0';\n");

    const results = syncCarriers(root, "0.5.0");

    assert.equal(
      results.find((r) => r.path === "apps/web/android/app/build.gradle")?.status,
      "updated",
    );
    assert.equal(
      results.find((r) => r.path === "packages/learning/src/version.ts")?.status,
      "updated",
    );
    assert.equal(
      results.find((r) => r.path === "apps/web/app/api/health/route.ts")?.status,
      "missing",
    );
    assert.match(fs.readFileSync(gradle, "utf8"), /versionName "0\.5\.0"/);
    assert.match(fs.readFileSync(learning, "utf8"), /LEARNING_CODE_VERSION = '0\.5\.0'/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("syncCarriers es idempotente: la segunda pasada no cambia nada", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carriers-"));
  try {
    const learning = path.join(root, "packages/learning/src/version.ts");
    fs.mkdirSync(path.dirname(learning), { recursive: true });
    fs.writeFileSync(learning, "export const LEARNING_CODE_VERSION = '0.4.0';\n");

    syncCarriers(root, "0.5.0");
    const second = syncCarriers(root, "0.5.0");

    assert.equal(
      second.find((r) => r.path === "packages/learning/src/version.ts")?.status,
      "unchanged",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("el check y la sincronización comparten la misma tabla de carriers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carriers-"));
  try {
    const learning = path.join(root, "packages/learning/src/version.ts");
    fs.mkdirSync(path.dirname(learning), { recursive: true });
    fs.writeFileSync(learning, "export const LEARNING_CODE_VERSION = '0.4.0';\n");

    // El check tiene que ver el carrier desactualizado: es el mismo que la
    // sincronización actualiza.
    const mismatches = findVersionMismatches(root, "0.5.0");
    assert.equal(mismatches.length, 1);
    assert.equal(mismatches[0]?.path, "packages/learning/src/version.ts");
    assert.equal(mismatches[0]?.found, "0.4.0");

    syncCarriers(root, "0.5.0");
    assert.deepEqual(findVersionMismatches(root, "0.5.0"), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
