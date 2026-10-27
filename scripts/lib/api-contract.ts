/**
 * Inventario de la API HTTP y paridad con el contrato OpenAPI.
 *
 * Este módulo es la fuente de verdad *del código*: recorre
 * `apps/web/app/api/**\/route.ts`, deduce la URL y los métodos que cada
 * handler exporta, y los compara con lo que declara el contrato
 * (`docs/contract/openapi.yaml`).
 *
 * La comparación es lo que impide que el contrato se quede viejo: si alguien
 * agrega una ruta y no la declara en el contrato, el check falla en CI.
 *
 * Funciones puras sobre strings y estructuras: no tocan el disco salvo
 * `readApiRoutes`, que sí lo hace (y por eso vive en el mismo módulo que el
 * resto para no duplicar la lógica de parseo).
 */
import fs from "node:fs";
import path from "node:path";

/** Métodos HTTP que un route handler de Next.js puede exportar. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/** Un método HTTP soportado por un route handler. */
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Una ruta de la API, tal como está implementada en el código. */
export interface ApiRoute {
  /** Método HTTP. */
  readonly method: HttpMethod;
  /** Ruta pública, con los parámetros como `{id}`. */
  readonly path: string;
  /** Ruta del archivo que la implementa, relativa a la raíz del repo. */
  readonly file: string;
}

/** Ruta del directorio que contiene los route handlers de la API. */
export const API_ROUTE_ROOT = "apps/web/app/api";

/** Prefijo de la ruta pública, relativo al árbol de archivos de la app. */
const PUBLIC_PREFIX = "/api";

const METHOD_ALTERNATION = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";
const EXPORTED_FUNCTION = new RegExp(
  `^export\\s+(?:async\\s+)?function\\s+(${METHOD_ALTERNATION})\\b`,
  "gm",
);
const EXPORTED_CONST = new RegExp(`^export\\s+(?:const|let|var)\\s+(${METHOD_ALTERNATION})\\b`, "gm");

/**
 * Convierte la ruta de un archivo en la ruta pública de la API.
 *
 * `apps/web/app/api/conversations/[id]/route.ts` → `/api/conversations/{id}`.
 * Los segmentos dinámicos se normalizan a la forma de OpenAPI (`{id}`) y el
 * catch-all (`[...nextauth]`) a `{...nextauth}`.
 */
export function routeFileToApiPath(file: string): string {
  const normalized = file.replaceAll(path.sep, "/");
  const prefix = `${API_ROUTE_ROOT}/`;
  if (!normalized.startsWith(prefix)) {
    throw new Error(`el archivo no está bajo ${API_ROUTE_ROOT}: ${file}`);
  }
  const relative = normalized.slice(prefix.length).replace(/\/?route\.ts$/, "");
  const segments = relative
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment);
      if (catchAll) return `{...${catchAll[1]}}`;
      const dynamic = /^\[(.+)\]$/.exec(segment);
      if (dynamic) return `{${dynamic[1]}}`;
      return segment;
    });
  return segments.length === 0 ? PUBLIC_PREFIX : `${PUBLIC_PREFIX}/${segments.join("/")}`;
}

/** Extrae los métodos HTTP que exporta un route handler. */
export function extractRouteMethods(source: string): HttpMethod[] {
  const methods = new Set<HttpMethod>();
  for (const match of source.matchAll(EXPORTED_FUNCTION)) {
    methods.add(match[1] as HttpMethod);
  }
  for (const match of source.matchAll(EXPORTED_CONST)) {
    methods.add(match[1] as HttpMethod);
  }
  return HTTP_METHODS.filter((method) => methods.has(method));
}

/**
 * Recorre los route handlers de la API y devuelve el inventario.
 *
 * `root` es la raíz del repo. El resultado viene ordenado por ruta y método
 * para que la salida sea estable y comparable entre corridas.
 */
export function readApiRoutes(root: string): ApiRoute[] {
  const apiRoot = path.join(root, API_ROUTE_ROOT);
  if (!fs.existsSync(apiRoot)) return [];
  const routes: ApiRoute[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== "route.ts") continue;
      const source = fs.readFileSync(full, "utf8");
      const apiPath = routeFileToApiPath(path.relative(root, full));
      for (const method of extractRouteMethods(source)) {
        routes.push({
          method,
          path: apiPath,
          file: path.relative(root, full).replaceAll(path.sep, "/"),
        });
      }
    }
  };
  walk(apiRoot);
  return routes.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}

/** Un método y una ruta declarados en el contrato. */
export interface ContractOperation {
  readonly method: HttpMethod;
  readonly path: string;
}

/**
 * Compara el inventario del código con el del contrato.
 *
 * Devuelve las operaciones que están en el código y no en el contrato
 * (`missingInContract`) y las que están en el contrato y no en el código
 * (`missingInCode`). Las dos listas vacías significan paridad.
 */
export function compareRoutesToContract(
  routes: readonly ApiRoute[],
  operations: readonly ContractOperation[],
): { missingInContract: readonly string[]; missingInCode: readonly string[] } {
  const code = new Set(routes.map((route) => `${route.method} ${route.path}`));
  const contract = new Set(operations.map((operation) => `${operation.method} ${operation.path}`));
  return {
    missingInContract: [...code].filter((entry) => !contract.has(entry)).sort(),
    missingInCode: [...contract].filter((entry) => !code.has(entry)).sort(),
  };
}
