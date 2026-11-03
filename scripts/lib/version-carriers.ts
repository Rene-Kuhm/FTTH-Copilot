/**
 * Los version carriers del repo: los ficheros que llevan la versión del
 * release y que `pnpm check:version` valida contra el tag publicado.
 *
 * Hay dos dueños:
 *
 *   - `release-please` los actualiza solo: los `package.json`, el
 *     `tauri.conf.json` y el `Cargo.toml`.
 *   - `sync` los actualiza el paso de sincronización del pipeline de release
 *     (`scripts/sync-version-carriers.ts`).
 *
 * La lista vive acá y en ningún otro lado: el check y la sincronización leen
 * los dos esta misma tabla. Cuando entra un carrier nuevo, alcanza con
 * agregarlo acá y los dos caminos lo cubren.
 *
 * El error que motivó la lista única: `packages/learning/src/version.ts` se
 * agregó al check cuando entró el núcleo de learning (#348) pero no entró al
 * paso de sincronización. El release 0.5.0 salió con ese carrier en 0.4.0, la
 * verificación del tag falló y la release quedó sin SBOM.
 */
import fs from "node:fs";
import path from "node:path";

/** Quién actualiza el fichero que lleva la versión. */
export type CarrierOwner = "release-please" | "sync";

/** Un fichero que lleva la versión del release. */
export interface VersionCarrier {
  /** Ruta relativa a la raíz del repo. */
  readonly path: string;
  /** Cómo se llama en el mensaje del check. */
  readonly label: string;
  /** Patrón que encuentra la versión (el grupo 1 la captura). */
  readonly pattern: RegExp;
  /** Quién la actualiza. */
  readonly owner: CarrierOwner;
}

/** Los carriers de fichero fijo. Los `package.json` se listan aparte. */
export const VERSION_CARRIERS: readonly VersionCarrier[] = [
  {
    path: "apps/web/src-tauri/tauri.conf.json",
    label: "Tauri version",
    pattern: /"version"\s*:\s*"([^"]+)"/,
    owner: "release-please",
  },
  {
    path: "apps/web/src-tauri/Cargo.toml",
    label: "Cargo version",
    pattern: /^version\s*=\s*"([^"]+)"/m,
    owner: "release-please",
  },
  {
    path: "apps/web/android/app/build.gradle",
    label: "Android versionName",
    pattern: /versionName\s+"([^"]+)"/,
    owner: "sync",
  },
  {
    path: "apps/web/app/api/health/route.ts",
    label: "health fallback",
    pattern: /npm_package_version[^\n]+\?\?\s*'([^']+)'/,
    owner: "sync",
  },
  {
    path: "packages/agent-core/src/telemetry/exporter.ts",
    label: "telemetry scope version",
    pattern: /version:\s*'([^']+)'/,
    owner: "sync",
  },
  {
    path: "packages/learning/src/version.ts",
    label: "learning code version",
    pattern: /LEARNING_CODE_VERSION\s*=\s*'([^']+)'/,
    owner: "sync",
  },
];

/**
 * Los `package.json` que llevan la versión.
 *
 * Los gestiona release-please (`extra-files`), así que no entran en la
 * sincronización: pero el check los valida igual.
 */
export function packageManifestPaths(root: string): string[] {
  const packagesDir = path.join(root, "packages");
  const connectors = ["core", "mikrotik", "mikrowisp", "smartolt"].map((name) =>
    path.join("packages", "connectors", name, "package.json"),
  );
  const inPackages = fs.existsSync(packagesDir)
    ? fs
        .readdirSync(packagesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join("packages", entry.name, "package.json"))
        .filter((manifest) => fs.existsSync(path.join(root, manifest)))
    : [];
  return [
    "package.json",
    "apps/web/package.json",
    ...inPackages,
    ...connectors.filter((manifest) => fs.existsSync(path.join(root, manifest))),
  ];
}

/** Lee la versión de un carrier, o `null` si el patrón no aparece. */
export function readCarrierVersion(content: string, carrier: VersionCarrier): string | null {
  const match = content.match(carrier.pattern);
  return match?.[1] ?? null;
}

/** Escribe la versión en un carrier. Si el patrón no aparece, no toca nada. */
export function writeCarrierVersion(
  content: string,
  carrier: VersionCarrier,
  version: string,
): string {
  return content.replace(carrier.pattern, (match, current: string) => match.replace(current, version));
}

/** Qué pasó con un carrier en una pasada de sincronización. */
export type SyncStatus = "updated" | "unchanged" | "missing" | "no-match";

/** El resultado de sincronizar un carrier. */
export interface SyncResult {
  /** Ruta relativa del carrier. */
  readonly path: string;
  /** Qué pasó con él. */
  readonly status: SyncStatus;
}

/**
 * Sincroniza los carriers que release-please no actualiza.
 *
 * Un carrier que no está en el repo se salta: no es un carrier todavía. Uno
 * que está pero cuyo patrón no aparece también: se avisa, para que el
 * check lo reporte como un carrier sin versión.
 */
export function syncCarriers(root: string, version: string): SyncResult[] {
  const results: SyncResult[] = [];
  for (const carrier of VERSION_CARRIERS.filter((candidate) => candidate.owner === "sync")) {
    const file = path.join(root, carrier.path);
    if (!fs.existsSync(file)) {
      results.push({ path: carrier.path, status: "missing" });
      continue;
    }
    const content = fs.readFileSync(file, "utf8");
    if (readCarrierVersion(content, carrier) === version) {
      results.push({ path: carrier.path, status: "unchanged" });
      continue;
    }
    const updated = writeCarrierVersion(content, carrier, version);
    if (updated === content) {
      results.push({ path: carrier.path, status: "no-match" });
      continue;
    }
    fs.writeFileSync(file, updated);
    results.push({ path: carrier.path, status: "updated" });
  }
  return results;
}

/** Un carrier que no lleva la versión del release. */
export interface VersionMismatch {
  /** Ruta relativa del carrier. */
  readonly path: string;
  /** Cómo se llama en el mensaje. */
  readonly label: string;
  /** La versión que tenía. */
  readonly found: string;
}

/**
 * Los carriers que no llevan la versión esperada.
 *
 * Es la misma tabla que usa la sincronización: si un carrier nuevo entra en
 * `VERSION_CARRIERS`, el check lo valida y la sincronización lo actualiza, sin
 * que haya que tocar dos listas.
 */
export function findVersionMismatches(root: string, expected: string): VersionMismatch[] {
  const mismatches: VersionMismatch[] = [];

  for (const manifest of packageManifestPaths(root)) {
    const file = path.join(root, manifest);
    if (!fs.existsSync(file)) continue;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: string };
    const found = parsed.version ?? "<missing>";
    if (found !== expected) mismatches.push({ path: manifest, label: "package version", found });
  }

  for (const carrier of VERSION_CARRIERS) {
    const file = path.join(root, carrier.path);
    if (!fs.existsSync(file)) continue;
    const found = readCarrierVersion(fs.readFileSync(file, "utf8"), carrier);
    if (found !== expected) {
      mismatches.push({ path: carrier.path, label: carrier.label, found: found ?? "<missing>" });
    }
  }

  return mismatches;
}
