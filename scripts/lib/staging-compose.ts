/**
 * Fusión del compose de staging, sin Docker.
 *
 * El staging se levanta con dos archivos: `docker-compose.prod.yml` y el
 * override `docker-compose.staging.yml`. Compose los fusiona con reglas
 * propias: los mapas se mezclan por clave, las listas se concatenan, y los
 * tags `!reset` y `!override` pisan el valor del base.
 *
 * Por qué leerlo acá y no en un despliegue: un servicio al que le falta
 * `DATABASE_URL` no falla al levantar el compose —falla después, cuando
 * Prisma busca la variable— y deja el stack entero abajo, porque la web y
 * el worker dependen de que las migraciones terminen bien. Ver eso en el
 * CI cuesta mucho menos que verlo en un despliegue.
 *
 * La lectura no necesita el daemon de Docker: alcanza con parsear los dos
 * YAML y fusionarlos con las mismas reglas.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/** Un servicio del compose, ya fusionado. */
export interface ComposeService {
  environment?: Record<string, string>;
  ports?: string[];
  profiles?: string[];
  env_file?: string[];
  network_mode?: string;
  [key: string]: unknown;
}

/** Un archivo del compose, ya fusionado. */
export interface ComposeFile {
  services: Record<string, ComposeService>;
}

/** Un valor del compose con su tag custom (`!reset`, `!override`). */
interface TaggedValue {
  value: unknown;
  tag?: string;
}

/** Un servicio con cada clave anotada con su tag. */
type TaggedService = Record<string, TaggedValue>;

/** Tags que pisan el valor del base en vez de fusionarse con él. */
const OVERRIDING_TAGS = new Set(['!reset', '!override']);

/** Interpolación con llaves: `${VAR}`, `${VAR:-def}`, `${VAR:?msg}`. */
const BRACED_VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}/g;

/** Interpolación sin llaves: `$VAR`. */
const PLAIN_VARIABLE = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

function isPlainMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** El valor de un nodo YAML, sin el tag. */
function plainValue(node: unknown): unknown {
  if (node && typeof node === 'object' && 'toJSON' in node) {
    return (node as { toJSON: () => unknown }).toJSON();
  }
  return node;
}

/** Parsea los servicios de un compose, anotando cada clave con su tag. */
function parseTaggedServices(content: string): Record<string, TaggedService> {
  const document = YAML.parseDocument(content);
  if (document.errors.length > 0) {
    const detail = document.errors.map((error) => error.message).join('; ');
    throw new Error(`compose inválido: ${detail}`);
  }

  const services: Record<string, TaggedService> = {};
  const root = document.get('services', true);
  if (!YAML.isMap(root)) {
    throw new Error('el compose no declara un mapa `services`');
  }

  for (const item of root.items) {
    const name = String(item.key);
    const body = item.value;
    if (!YAML.isMap(body)) {
      throw new Error(`el servicio ${name} no es un mapa`);
    }
    const service: TaggedService = {};
    for (const entry of body.items) {
      const key = String(entry.key);
      const node = entry.value;
      const tag = YAML.isNode(node) ? node.tag : undefined;
      service[key] = { value: plainValue(node), tag };
    }
    services[name] = service;
  }

  return services;
}

/**
 * Fusiona dos valores de compose.
 *
 * Mismo criterio que Compose: los mapas se mezclan por clave, las listas
 * se concatenan y el resto lo pisa el override. Los tags `!reset` y
 * `!override` pisan siempre.
 */
function mergeValues(base: TaggedValue, override: TaggedValue): unknown {
  if (override.tag && OVERRIDING_TAGS.has(override.tag)) {
    return override.value;
  }
  if (isPlainMap(base.value) && isPlainMap(override.value)) {
    return { ...base.value, ...override.value };
  }
  if (Array.isArray(base.value) && Array.isArray(override.value)) {
    return [...base.value, ...override.value];
  }
  return override.value;
}

/** El `environment` de un servicio, con todos los valores como texto. */
function normalizeEnvironment(service: ComposeService): ComposeService {
  if (!isPlainMap(service.environment)) return service;
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(service.environment)) {
    environment[key] = value === null || value === undefined ? '' : String(value);
  }
  return { ...service, environment };
}

/**
 * Fusiona el compose de producción con el override de staging y devuelve
 * el modelo que Compose usaría para levantar el stack.
 */
export function mergeCompose(baseContent: string, overrideContent: string): ComposeFile {
  const base = parseTaggedServices(baseContent);
  const override = parseTaggedServices(overrideContent);

  const names = new Set([...Object.keys(base), ...Object.keys(override)]);
  const services: Record<string, ComposeService> = {};

  for (const name of names) {
    const baseService = base[name] ?? {};
    const overrideService = override[name] ?? {};
    const keys = new Set([...Object.keys(baseService), ...Object.keys(overrideService)]);

    const merged: Record<string, unknown> = {};
    for (const key of keys) {
      const fromBase = baseService[key];
      const fromOverride = overrideService[key];
      if (!fromBase) {
        merged[key] = fromOverride?.value;
        continue;
      }
      if (!fromOverride) {
        merged[key] = fromBase.value;
        continue;
      }
      merged[key] = mergeValues(fromBase, fromOverride);
    }

    services[name] = normalizeEnvironment(merged as ComposeService);
  }

  return { services };
}

/** El `environment` de un servicio (mapa de texto), o un mapa vacío. */
export function serviceEnvironment(service: ComposeService | undefined): Record<string, string> {
  if (!service || !isPlainMap(service.environment)) return {};
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(service.environment)) {
    environment[key] = value === null || value === undefined ? '' : String(value);
  }
  return environment;
}

/** Los puertos publicados de un servicio. */
export function servicePorts(service: ComposeService | undefined): string[] {
  if (!service || !Array.isArray(service.ports)) return [];
  return service.ports.map((port) => String(port));
}

/**
 * Si la interpolación exige la variable: `${VAR}` y `${VAR:?msg}` sí;
 * `${VAR:-def}` y `${VAR-def}` no.
 */
function suffixIsRequired(suffix: string): boolean {
  if (suffix === '') return true;
  if (suffix.startsWith(':-') || suffix.startsWith('-')) return false;
  if (suffix.startsWith(':?') || suffix.startsWith('?')) return true;
  return false;
}

/** Los textos de un servicio donde puede haber una interpolación. */
function interpolableStrings(service: ComposeService): string[] {
  const texts: string[] = [];
  for (const value of Object.values(service.environment ?? {})) {
    texts.push(String(value));
  }
  for (const port of servicePorts(service)) {
    texts.push(port);
  }
  if (Array.isArray(service.command)) {
    for (const part of service.command) {
      texts.push(String(part));
    }
  }
  return texts;
}

/**
 * Las variables que el compose exige tener definidas: las que se
 * interpolan sin default.
 */
export function requiredEnvVariables(services: Record<string, ComposeService>): string[] {
  const required = new Set<string>();
  for (const service of Object.values(services)) {
    for (const text of interpolableStrings(service)) {
      for (const match of text.matchAll(BRACED_VARIABLE)) {
        const name = match[1];
        const suffix = match[2] ?? '';
        if (name && suffixIsRequired(suffix)) required.add(name);
      }
      for (const match of text.matchAll(PLAIN_VARIABLE)) {
        const name = match[1];
        if (name) required.add(name);
      }
    }
  }
  return [...required].sort();
}

/** Los nombres de variable que define un archivo `.env`. */
export function envFileVariables(content: string): Set<string> {
  const names = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(trimmed);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

/** El compose de staging ya fusionado, tal como lo levanta Compose. */
export function loadStagingCompose(repoRoot: string): ComposeFile {
  const prod = fs.readFileSync(path.join(repoRoot, 'docker-compose.prod.yml'), 'utf8');
  const staging = fs.readFileSync(path.join(repoRoot, 'docker-compose.staging.yml'), 'utf8');
  return mergeCompose(prod, staging);
}
