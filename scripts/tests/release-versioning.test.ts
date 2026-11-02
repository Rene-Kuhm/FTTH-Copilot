import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";

/**
 * Todo paquete del workspace tiene que estar registrado en los `extra-files`
 * de release-please.
 *
 * Un paquete que no está ahí no recibe versión nueva en el release: se queda
 * con la anterior y **el siguiente release falla su propia verificación**
 * (`scripts/check-release-version.ts` compara todos los manifiestos con la
 * versión publicada).
 *
 * No es hipotético: el release 0.4.0 se publicó con el paso de verificación
 * en rojo porque siete paquetes no estaban registrados.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

/** Manifiestos de todos los paquetes del workspace, por ruta relativa. */
function workspaceManifests(): string[] {
  const manifests: string[] = [];

  for (const entry of fs.readdirSync(path.join(ROOT, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join("packages", entry.name, "package.json");
    if (fs.existsSync(path.join(ROOT, manifest))) manifests.push(manifest);
  }

  for (const entry of fs.readdirSync(path.join(ROOT, "packages", "connectors"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join("packages", "connectors", entry.name, "package.json");
    if (fs.existsSync(path.join(ROOT, manifest))) manifests.push(manifest);
  }

  for (const entry of fs.readdirSync(path.join(ROOT, "services"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join("services", entry.name, "package.json");
    if (fs.existsSync(path.join(ROOT, manifest))) manifests.push(manifest);
  }

  return manifests.sort();
}

/** Rutas que release-please versiona en cada release. */
function versionedByReleasePlease(): Set<string> {
  const config = readJson("release-please-config.json");
  const root = (config["packages"] ?? {}) as Record<string, Record<string, unknown>>;
  const extraFiles = (root["."]?.["extra-files"] ?? []) as Array<{ path?: string }>;
  return new Set(extraFiles.map((entry) => entry.path ?? ""));
}

test("todo paquete del workspace está registrado en los extra-files de release-please", () => {
  const versioned = versionedByReleasePlease();
  const missing = workspaceManifests().filter((manifest) => !versioned.has(manifest));

  assert.deepEqual(
    missing,
    [],
    `estos paquetes no los versiona el release: ${missing.join(", ")}`,
  );
});

test("todos los manifiestos del workspace declaran la misma versión", () => {
  const versions = new Map<string, string>();

  for (const manifest of [...workspaceManifests(), "apps/web/package.json"]) {
    const pkg = readJson(manifest) as { version?: string };
    versions.set(manifest, pkg.version ?? "<missing>");
  }

  const distinct = new Set(versions.values());
  assert.equal(
    distinct.size,
    1,
    `las versiones divergen: ${[...versions.entries()]
      .map(([manifest, version]) => `${manifest}=${version}`)
      .join(", ")}`,
  );
});
