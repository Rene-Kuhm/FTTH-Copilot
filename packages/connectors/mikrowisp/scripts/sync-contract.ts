/**
 * Regenera el subconjunto de contrato del conector Mikrowisp.
 *
 * La documentación pública de Mikrowisp es una colección en
 * `docs.mikrosystem.net`; el documento OpenAPI que este script consume es la
 * revisión que `skmtc.dev/mikrosystem/apis/mikrowisp` publica como espejo
 * machine-readable. El subconjunto versionado en
 * `contract/mikrowisp-openapi.subset.json` registra las dos URLs para que la
 * procedencia quede explícita.
 *
 *   node --experimental-strip-types scripts/sync-contract.ts
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readArtifactText, writeArtifact } from '../../../../scripts/lib/http-artifact.ts';

/** El espejo machine-readable que se consume (revisión fija, no "latest"). */
const SOURCE_URL = 'https://skmtc.dev/mikrosystem/apis/mikrowisp/revisions/636806eac943?raw';

/** La documentación canónica del proveedor que ese espejo replica. */
const CANONICAL_DOCS_URL = 'https://docs.mikrosystem.net';

/** El subconjunto que consume el conector. */
const CONTRACT_PATH_PATTERNS: readonly RegExp[] = [
  /^\/GetRouters$/,
  /^\/GetMonitoreo$/,
  /^\/GetAllClients$/,
  /^\/SmartOltGetODB$/,
];

/** Dónde queda el subconjunto, relativo a este script. */
const CONTRACT_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'contract');
const OUTPUT_PATH = join(CONTRACT_DIRECTORY, 'mikrowisp-openapi.subset.json');

interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string };
  servers?: unknown;
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
  const content = await readArtifactText(response, ['application/json']);
  const document = JSON.parse(content) as OpenApiDocument;
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
      'SUBCONJUNTO de la especificación de Mikrowisp: sólo los endpoints que llama ' +
      '@ftth-copilot/connectors-mikrowisp. No editar a mano: regenerar con ' +
      '`node --experimental-strip-types scripts/sync-contract.ts`.',
    provenance: {
      sourceUrl: SOURCE_URL,
      sourceKind: 'third-party-mirror',
      canonicalDocsUrl: CANONICAL_DOCS_URL,
      retrievedAt: new Date().toISOString().slice(0, 10),
      openapi: document.openapi ?? null,
      documentTitle: document.info?.title ?? null,
      documentVersion: document.info?.version ?? null,
      subset: true,
      pathPatterns: CONTRACT_PATH_PATTERNS.map(String),
      note:
        'El espejo de skmtc.dev replica docs.mikrosystem.net; el documento no publica ' +
        '`info.description` ni `security`, así que la autenticación por `token` en el cuerpo ' +
        'sale de los `requestBody` de cada endpoint. Los tests de contrato corren offline ' +
        'contra este archivo.',
    },
    openapi: document.openapi ?? null,
    info: document.info ?? null,
    servers: document.servers ?? null,
    paths,
  };

  writeArtifact(CONTRACT_DIRECTORY, OUTPUT_PATH, `${JSON.stringify(subset, null, 2)}\n`);
  console.log(`Contrato Mikrowisp actualizado: ${found.length} endpoints → ${OUTPUT_PATH}`);
}

await main();
