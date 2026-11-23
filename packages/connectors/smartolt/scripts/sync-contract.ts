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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readArtifactText, writeArtifact } from '../../../../scripts/lib/http-artifact.ts';

/** La especificación oficial, machine-readable. */
const SOURCE_URL = 'https://www.smartolt.com/openapi.json';

/** El subconjunto que consume el conector. */
const CONTRACT_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/system\/get_olts$/,
  /^\/api\/onu\/get_all_onus_details$/,
  /^\/api\/olt\/get_olt_uptime_and_env_temperature\/\{olt_id\}$/,
  /^\/api\/system\/get_zones$/,
  // El stream de eventos en tiempo real (S3): el endpoint que entrega la URL.
  /^\/api\/onu\/get_event_stream$/,
];

/**
 * Los tipos de evento cuyo ejemplo se versiona en el contrato.
 *
 * Tiene que coincidir con `SMARTOLT_EVENT_TYPES` de `src/schemas.ts`: el test
 * de contrato compara las dos listas, así que agregar un tipo en un solo lado
 * falla.
 */
const EVENT_TYPES: readonly string[] = [
  'onu.status_changed',
  'onu.authorized',
  'onu.updated',
  'onu.deleted',
  'onu.signal_changed',
  'onu.signal_reading',
  'onu.rx1490_reading',
  'onu.unconfigured_detected',
  'pon.outage_started',
  'pon.outage_ended',
  'olt.status_stale',
  'olt.status_fresh',
];

/** Dónde queda el subconjunto, relativo a este script. */
const CONTRACT_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'contract');
const OUTPUT_PATH = join(CONTRACT_DIRECTORY, 'smartolt-openapi.subset.json');

interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, unknown>;
  'x-webhooks'?: Record<string, unknown>;
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

/**
 * Los ejemplos oficiales del cuerpo de cada evento.
 *
 * La especificación los publica bajo el webhook (`x-webhooks`), no en el path
 * del stream: el cuerpo es el mismo para los dos transportes, que es
 * exactamente lo que el conector asume. Se copian tal cual, sin recortar
 * campos, para que el test parsee el ejemplo completo.
 */
function extractEventExamples(document: OpenApiDocument): Record<string, unknown> {
  const webhooks = document['x-webhooks'] as
    | Record<
        string,
        { post?: { requestBody?: { content?: Record<string, { examples?: Record<string, { value?: unknown }> }> } } }
      >
    | undefined;
  const examples =
    webhooks?.['smartolt-webhook']?.post?.requestBody?.content?.['application/json']?.examples ?? {};

  const selected: Record<string, unknown> = {};
  for (const type of EVENT_TYPES) {
    const example = examples[type];
    if (example === undefined) continue;
    selected[type] = example.value;
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
  const eventExamples = extractEventExamples(document);
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

  const missingEvents = EVENT_TYPES.filter((type) => eventExamples[type] === undefined);
  if (missingEvents.length > 0) {
    throw new Error(
      `La especificación ya no publica el ejemplo de estos eventos: ${missingEvents.join(', ')}. ` +
        'El conector dejó de ser compatible con el cuerpo de esos eventos.',
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
      eventTypes: EVENT_TYPES,
      note:
        'Los tests de contrato corren offline contra este archivo. Si el proveedor cambia ' +
        'la forma de un endpoint que el conector usa, el CI falla.',
    },
    openapi: document.openapi ?? null,
    info: document.info ?? null,
    paths,
    eventExamples,
  };

  writeArtifact(CONTRACT_DIRECTORY, OUTPUT_PATH, `${JSON.stringify(subset, null, 2)}\n`);
  console.log(`Contrato SmartOLT actualizado: ${found.length} endpoints → ${OUTPUT_PATH}`);
}

await main();
