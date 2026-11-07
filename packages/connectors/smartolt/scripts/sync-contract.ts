/**
 * Regenera el subconjunto de contrato del conector SmartOLT.
 *
 * El conector no implementa la API entera: llama a unos pocos endpoints. Este
 * script baja la especificación oficial, se queda con esos endpoints y deja el
 * resultado versionado en `contract/smartolt-openapi.subset.json`. Los tests
 * de contrato (que corren sin red) comparan el cliente y el mock contra ese
 * archivo, así que si el proveedor cambia la forma de un endpoint que usamos,
 * el CI falla.
 *
 *   node --experimental-strip-types scripts/sync-contract.ts
 *
 * El script no valida nada ni falla el build: su único trabajo es reescribir
 * el subconjunto con la información de procedencia. Revisar el diff a mano es
 * parte del trámite.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** La especificación oficial, machine-readable. */
const SOURCE_URL = 'https://www.smartolt.com/openapi.json';

/** El subconjunto que consume el conector. */
const CONTRACT_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/system\/get_olts$/,
  /^\/api\/onu\/get_all_onus_details$/,
  /^\/api\/olt\/get_olt_uptime_and_env_temperature\/\{olt_id\}$/,
  /^\/api\/system\/get_zones$/,
];

/** Dónde queda el subconjunto, relativo a este script. */
const OUTPUT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'contract', 'smartolt-openapi.subset.json');

interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Se queda con los paths que el conector llama, y sólo esos. */
function extractSubset(document: OpenApiDocument): Record<string, unknown> {
  const paths = document.paths ?? {};
  const selected: Record<string, unknown> = {};
  for (const [path, item] of Object.entries(paths)) {
    if (CONTRACT_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
      selected[path] = item;
    }
  }
  return selected;
}

async function main(): Promise<void> {
  const response = await fetch(SOURCE_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`No se pudo leer ${SOURCE_URL}: HTTP ${response.status}`);
  }
  const document = (await response.json()) as OpenApiDocument;
  const paths = extractSubset(document);
  const found = Object.keys(paths);

  const missing = CONTRACT_PATH_PATTERNS.filter(
    (pattern) => !found.some((path) => pattern.test(path)),
  );
  if (missing.length > 0) {
    throw new Error(
      `La especificación ya no publica estos endpoints: ${missing.map(String).join(', ')}. ` +
        'El conector dejó de ser compatible: hay que revisar el cliente antes de regenerar el contrato.',
    );
  }

  const subset = {
    $comment:
      'SUBCONJUNTO de la especificación oficial de SmartOLT: sólo los endpoints que llama ' +
      '@ftth-copilot/connectors-smartolt. No editar a mano: regenerar con ' +
      '`node --experimental-strip-types scripts/sync-contract.ts`.',
    provenance: {
      sourceUrl: SOURCE_URL,
      retrievedAt: new Date().toISOString().slice(0, 10),
      openapi: document.openapi ?? null,
      documentTitle: document.info?.title ?? null,
      documentVersion: document.info?.version ?? null,
      subset: true,
      pathPatterns: CONTRACT_PATH_PATTERNS.map(String),
      note:
        'Los tests de contrato corren offline contra este archivo. Si el proveedor cambia ' +
        'la forma de un endpoint que el conector usa, el CI falla.',
    },
    openapi: document.openapi ?? null,
    info: document.info ?? null,
    paths,
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(subset, null, 2)}\n`, 'utf8');
  console.log(`Contrato SmartOLT actualizado: ${found.length} endpoints → ${OUTPUT_PATH}`);
}

await main();
