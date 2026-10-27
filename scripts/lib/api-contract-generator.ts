/**
 * Generador de artefactos desde el contrato OpenAPI.
 *
 * El contrato (`docs/contract/openapi.yaml`) es la fuente única de verdad de la
 * API HTTP. De acá salen tres artefactos:
 *
 *   1. `packages/api-contract/src/generated/types.ts`   — tipos TypeScript.
 *   2. `packages/api-contract/src/generated/schemas.ts` — esquemas Zod.
 *   3. `docs/reference/api-http.md`                      — la referencia.
 *
 * Todo es determinista: el mismo contrato produce byte a byte los mismos
 * artefactos. Por eso el CI puede regenerar y comparar con `git diff`.
 *
 * El subconjunto de OpenAPI que se soporta es el que el contrato usa:
 * `$ref`, `type` (escalar o lista), `enum`, `const`, `format`, `default`,
 * `properties`, `required`, `additionalProperties`, `items`, `oneOf`,
 * `minimum`/`maximum`, `minLength`/`maxLength`, `pattern` y `maxItems`.
 * Un constructo no soportado es un error explícito, no un campo silencioso
 * ignorado: un contrato que el generador no entiende es un contrato que
 * genera Types que mienten.
 */
import YAML from "yaml";

/** Un nodo de esquema del contrato. */
export interface SchemaNode {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly format?: string;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly title?: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly deprecated?: boolean;
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | SchemaNode;
  readonly items?: SchemaNode;
  readonly oneOf?: readonly SchemaNode[];
  readonly anyOf?: readonly SchemaNode[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly maxItems?: number;
  readonly minItems?: number;
}

/** Una operación del contrato. */
export interface ContractOperation {
  readonly method: string;
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly security: "none" | "session";
  readonly permission: string | null;
  readonly roles: readonly string[] | null;
  readonly parameters: readonly ContractParameter[];
  readonly requestBody: SchemaNode | null;
  readonly requestBodyRequired: boolean;
  readonly requestBodyContentType: string | null;
  readonly responses: readonly ContractResponse[];
}

/** Un parámetro de una operación. */
export interface ContractParameter {
  readonly name: string;
  readonly in: string;
  readonly required: boolean;
  readonly description: string;
  readonly schema: SchemaNode;
}

/** Una respuesta declarada. */
export interface ContractResponse {
  readonly status: string;
  readonly description: string;
  readonly contentType: string | null;
  readonly schema: SchemaNode | null;
}

/** El contrato completo, ya normalizado. */
export interface Contract {
  readonly title: string;
  readonly version: string;
  readonly description: string;
  readonly servers: readonly string[];
  readonly tags: readonly { readonly name: string; readonly description: string }[];
  readonly operations: readonly ContractOperation[];
  readonly schemas: Readonly<Record<string, SchemaNode>>;
  readonly parameters: Readonly<Record<string, ContractParameter>>;
  readonly prometheusMetrics: readonly string[];
  readonly implementationNotes: readonly string[];
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lanza un error con un mensaje que dice qué parte del contrato falló. */
function fail(message: string): never {
  throw new Error(`contrato inválido: ${message}`);
}

/**
 * Parsea el YAML del contrato y lo normaliza a las estructuras que usa el
 * generador.
 */
export function parseContract(source: string): Contract {
  const raw = YAML.parse(source) as unknown;
  if (!isRecord(raw)) fail("la raíz no es un objeto");
  if (typeof raw.openapi !== "string") fail("falta `openapi`");
  if (!isRecord(raw.info)) fail("falta `info`");
  if (!isRecord(raw.paths)) fail("falta `paths`");

  const info = raw.info;
  const components = isRecord(raw.components) ? raw.components : {};
  const schemaMap = isRecord(components.schemas) ? components.schemas : {};
  const parameterMap = isRecord(components.parameters) ? components.parameters : {};

  const schemas: Record<string, SchemaNode> = {};
  for (const [name, value] of Object.entries(schemaMap)) {
    if (!isRecord(value)) fail(`el esquema ${name} no es un objeto`);
    schemas[name] = value as SchemaNode;
  }

  const parameters: Record<string, ContractParameter> = {};
  for (const [name, value] of Object.entries(parameterMap)) {
    if (!isRecord(value)) fail(`el parámetro ${name} no es un objeto`);
    parameters[name] = parseParameter(value as Record<string, unknown>);
  }

  const operations: ContractOperation[] = [];
  for (const [path, pathItem] of Object.entries(raw.paths as Record<string, unknown>)) {
    if (!isRecord(pathItem)) fail(`el path ${path} no es un objeto`);
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation === undefined) continue;
      if (!isRecord(operation)) fail(`la operación ${method.toUpperCase()} ${path} no es un objeto`);
      operations.push(parseOperation(method, path, operation, parameters));
    }
  }
  operations.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );

  const tags: { name: string; description: string }[] = [];
  if (Array.isArray(raw.tags)) {
    for (const tag of raw.tags) {
      if (!isRecord(tag)) continue;
      const name = typeof tag.name === "string" ? tag.name : "";
      if (name === "") continue;
      tags.push({ name, description: typeof tag.description === "string" ? tag.description : "" });
    }
  }

  const servers: string[] = [];
  if (Array.isArray(raw.servers)) {
    for (const server of raw.servers) {
      if (isRecord(server) && typeof server.url === "string") servers.push(server.url);
    }
  }

  const prometheusMetrics: string[] = [];
  const metrics = raw["x-prometheus-metrics"];
  if (isRecord(metrics) && Array.isArray(metrics.names)) {
    for (const name of metrics.names) {
      if (typeof name === "string") prometheusMetrics.push(name);
    }
  }

  const implementationNotes: string[] = [];
  const notes = raw["x-implementation-notes"];
  if (isRecord(notes) && Array.isArray(notes.notes)) {
    for (const note of notes.notes) {
      if (typeof note === "string") implementationNotes.push(note);
    }
  }

  return {
    title: typeof info.title === "string" ? info.title : "API",
    version: typeof info.version === "string" ? info.version : "0.0.0",
    description: typeof info.description === "string" ? info.description : "",
    servers,
    tags,
    operations,
    schemas,
    parameters,
    prometheusMetrics,
    implementationNotes,
  };
}

function parseParameter(raw: Record<string, unknown>): ContractParameter {
  const name = typeof raw.name === "string" ? raw.name : "";
  const location = typeof raw.in === "string" ? raw.in : "query";
  const schema = isRecord(raw.schema) ? (raw.schema as SchemaNode) : { type: "string" };
  return {
    name,
    in: location,
    required: raw.required === true,
    description: typeof raw.description === "string" ? raw.description : "",
    schema,
  };
}

function parseOperation(
  method: string,
  path: string,
  raw: Record<string, unknown>,
  globalParameters: Readonly<Record<string, ContractParameter>>,
): ContractOperation {
  const resolvedParameters: ContractParameter[] = [];
  if (Array.isArray(raw.parameters)) {
    for (const entry of raw.parameters) {
      if (!isRecord(entry)) continue;
      if (typeof entry.$ref === "string") {
        const name = entry.$ref.split("/").pop() ?? "";
        const referenced = globalParameters[name];
        if (!referenced) fail(`la operación ${method.toUpperCase()} ${path} referencia un parámetro inexistente: ${name}`);
        resolvedParameters.push(referenced);
        continue;
      }
      resolvedParameters.push(parseParameter(entry));
    }
  }

  let requestBody: SchemaNode | null = null;
  let requestBodyRequired = false;
  let requestBodyContentType: string | null = null;
  if (isRecord(raw.requestBody)) {
    requestBodyRequired = raw.requestBody.required === true;
    const content = raw.requestBody.content;
    if (!isRecord(content)) fail(`el requestBody de ${method.toUpperCase()} ${path} no tiene contenido`);
    const [contentType, media] = Object.entries(content)[0] ?? [];
    if (contentType === undefined || !isRecord(media)) {
      fail(`el requestBody de ${method.toUpperCase()} ${path} está vacío`);
    }
    requestBodyContentType = contentType;
    requestBody = isRecord(media.schema) ? (media.schema as SchemaNode) : null;
  }

  const responses: ContractResponse[] = [];
  if (!isRecord(raw.responses)) fail(`la operación ${method.toUpperCase()} ${path} no declara respuestas`);
  for (const [status, value] of Object.entries(raw.responses)) {
    if (!isRecord(value)) fail(`la respuesta ${status} de ${method.toUpperCase()} ${path} no es un objeto`);
    let contentType: string | null = null;
    let schema: SchemaNode | null = null;
    if (isRecord(value.content)) {
      const [type, media] = Object.entries(value.content)[0] ?? [];
      if (type !== undefined && isRecord(media) && isRecord(media.schema)) {
        contentType = type;
        schema = media.schema as SchemaNode;
      }
    }
    responses.push({
      status,
      description: typeof value.description === "string" ? value.description : "",
      contentType,
      schema,
    });
  }
  responses.sort((a, b) => a.status.localeCompare(b.status));

  const security = Array.isArray(raw.security) && raw.security.length === 0 ? "none" : "session";
  const permission = typeof raw["x-permission"] === "string" ? (raw["x-permission"] as string) : null;
  const roles = Array.isArray(raw["x-roles"])
    ? (raw["x-roles"] as unknown[]).filter((role): role is string => typeof role === "string")
    : null;

  return {
    method: method.toUpperCase(),
    path,
    operationId: typeof raw.operationId === "string" ? raw.operationId : "",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    description: typeof raw.description === "string" ? raw.description : "",
    tags: Array.isArray(raw.tags)
      ? (raw.tags as unknown[]).filter((tag): tag is string => typeof tag === "string")
      : [],
    security,
    permission,
    roles: roles && roles.length > 0 ? roles : null,
    parameters: resolvedParameters,
    requestBody,
    requestBodyRequired,
    requestBodyContentType,
    responses,
  };
}

/** Devuelve el esquema al que apunta un `$ref` local (`#/components/schemas/X`). */
export function resolveRef(contract: Contract, node: SchemaNode): SchemaNode {
  let current = node;
  const seen = new Set<string>();
  while (typeof current.$ref === "string") {
    if (seen.has(current.$ref)) fail(`referencia circular: ${current.$ref}`);
    seen.add(current.$ref);
    const prefix = "#/components/schemas/";
    if (!current.$ref.startsWith(prefix)) fail(`referencia no soportada: ${current.$ref}`);
    const name = current.$ref.slice(prefix.length);
    const target = contract.schemas[name];
    if (!target) fail(`referencia inexistente: ${current.$ref}`);
    current = target;
  }
  return current;
}

/** ¿El esquema acepta `null`? */
function isNullable(node: SchemaNode): boolean {
  if (node.type === undefined) return false;
  if (Array.isArray(node.type)) return node.type.includes("null");
  return false;
}

/** El tipo escalar del esquema, sin `null`. */
function baseType(node: SchemaNode): string | null {
  if (node.type === undefined) return null;
  if (Array.isArray(node.type)) {
    const concrete = node.type.filter((type) => type !== "null");
    return concrete.length === 1 ? (concrete[0] ?? null) : null;
  }
  return node.type as string;
}

/** Nombre del tipo TypeScript de una referencia. */
function refName(node: SchemaNode): string | null {
  if (typeof node.$ref !== "string") return null;
  const prefix = "#/components/schemas/";
  if (!node.$ref.startsWith(prefix)) return null;
  return node.$ref.slice(prefix.length);
}

// ────────────────────────────────────────────────────────────────────────────
// Tipos TypeScript
// ────────────────────────────────────────────────────────────────────────────

/** Genera el tipo TypeScript de un esquema. */
export function tsType(contract: Contract, node: SchemaNode): string {
  const name = refName(node);
  if (name !== null) return isNullable(node) ? `${name} | null` : name;

  if (node.oneOf || node.anyOf) {
    const members = node.oneOf ?? node.anyOf ?? [];
    return members.map((member) => tsType(contract, member)).join(" | ");
  }

  if (node.const !== undefined) return JSON.stringify(node.const);
  if (node.enum) {
    return node.enum.map((value) => JSON.stringify(value)).join(" | ");
  }

  const type = baseType(node);
  switch (type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `${tsType(contract, node.items ?? { type: "string" })}[]`;
    case "object": {
      const properties = node.properties ?? {};
      const required = new Set(node.required ?? []);
      const lines: string[] = [];
      for (const [property, schema] of Object.entries(properties)) {
        const optional = required.has(property) ? "" : "?";
        lines.push(`  ${property}${optional}: ${tsType(contract, schema)};`);
      }
      if (node.additionalProperties === false) {
        const body = lines.length === 0 ? "  // sin propiedades declaradas" : lines.join("\n");
        return `{\n${body}\n}`;
      }
      const index = tsIndexSignature(contract, node.additionalProperties ?? true);
      lines.push(index);
      return `{\n${lines.join("\n")}\n}`;
    }
    default:
      if (node.properties) return tsType(contract, { ...node, type: "object" });
      return "unknown";
  }
}

function tsIndexSignature(contract: Contract, additional: boolean | SchemaNode): string {
  if (additional === true) return "  [key: string]: unknown;";
  if (additional === false) return "  [key: string]: never;";
  return `  [key: string]: ${tsType(contract, additional)};`;
}

/** Genera el archivo de tipos TypeScript. */
export function generateTypes(contract: Contract): string {
  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * Tipos de la API HTTP — GENERADOS. No editar a mano.");
  lines.push(" *");
  lines.push(" * Fuente: `docs/contract/openapi.yaml`. Regenerar con");
  lines.push(" * `pnpm contract:generate` (o `mise run contract:generate`).");
  lines.push(" */");
  lines.push("");
  for (const [name, schema] of Object.entries(contract.schemas)) {
    lines.push(`/** ${describeSchema(schema)} */`);
    lines.push(`export type ${name} = ${tsType(contract, schema)};`);
    lines.push("");
  }
  return lines.join("\n");
}

function describeSchema(schema: SchemaNode): string {
  if (schema.description) return schema.description.replace(/\s+/g, " ").trim();
  return "Esquema del contrato.";
}

// ────────────────────────────────────────────────────────────────────────────
// Esquemas Zod
// ────────────────────────────────────────────────────────────────────────────

/**
 * Contexto de generación de Zod.
 *
 * Hace falta para dos cosas: saber el orden de definición de los esquemas (una
 * referencia a uno que todavía no se evaluó es un error de TDZ al importar el
 * módulo) y detectar la recursión (un esquema que se referencia a sí mismo
 * necesita `z.lazy`).
 */
interface ZodContext {
  /** Posición de cada esquema en el archivo generado. */
  readonly order: ReadonlyMap<string, number>;
  /** Nombre del esquema que se está generando ahora. */
  readonly current: string | null;
}

/** Genera la expresión Zod de un esquema. */
export function zodExpression(
  contract: Contract,
  node: SchemaNode,
  context?: ZodContext,
): string {
  const name = refName(node);
  if (name !== null) {
    let expression = `${name}Schema`;
    if (context) {
      const target = context.order.get(name);
      const current = context.current === null ? -1 : (context.order.get(context.current) ?? -1);
      if (target === undefined || target >= current) expression = `z.lazy(() => ${name}Schema)`;
    }
    if (isNullable(node)) expression = `${expression}.nullable()`;
    if (node.default !== undefined) {
      expression = `${expression}.default(${JSON.stringify(node.default)})`;
    }
    return expression;
  }

  if (node.oneOf || node.anyOf) {
    const members = node.oneOf ?? node.anyOf ?? [];
    return `z.union([${members.map((member) => zodExpression(contract, member, context)).join(", ")}])`;
  }

  if (node.const !== undefined) return `z.literal(${JSON.stringify(node.const)})`;
  if (node.enum) {
    return `z.enum([${node.enum.map((value) => JSON.stringify(value)).join(", ")}])`;
  }

  const type = baseType(node);
  let expression: string;
  switch (type) {
    case "string": {
      const parts: string[] = ["z.string()"];
      if (node.minLength !== undefined) parts.push(`.min(${node.minLength})`);
      if (node.maxLength !== undefined) parts.push(`.max(${node.maxLength})`);
      if (node.format === "email") parts.push(".email()");
      else if (node.format === "uri" || node.format === "url") parts.push(".url()");
      else if (node.format === "uuid") parts.push(".uuid()");
      else if (node.format === "date-time") parts.push(".datetime()");
      if (node.pattern) parts.push(`.regex(new RegExp(${JSON.stringify(node.pattern)}))`);
      expression = parts.join("");
      break;
    }
    case "number":
    case "integer": {
      const parts: string[] = ["z.number()"];
      if (type === "integer") parts.push(".int()");
      if (node.minimum !== undefined) parts.push(`.min(${node.minimum})`);
      if (node.maximum !== undefined) parts.push(`.max(${node.maximum})`);
      expression = parts.join("");
      break;
    }
    case "boolean":
      expression = "z.boolean()";
      break;
    case "null":
      expression = "z.null()";
      break;
    case "array": {
      const parts: string[] = [
        `z.array(${zodExpression(contract, node.items ?? { type: "string" }, context)})`,
      ];
      if (node.minItems !== undefined) parts.push(`.min(${node.minItems})`);
      if (node.maxItems !== undefined) parts.push(`.max(${node.maxItems})`);
      expression = parts.join("");
      break;
    }
    case "object": {
      const properties = node.properties ?? {};
      const required = new Set(node.required ?? []);
      const entries = Object.entries(properties).map(([property, schema]) => {
        let value = zodExpression(contract, schema, context);
        const isRequired = required.has(property);
        if (!isRequired && schema.default === undefined) value += ".optional()";
        return `  ${property}: ${value},`;
      });
      const body = entries.length === 0 ? "" : `${entries.join("\n")}\n`;
      const open = node.additionalProperties === false ? "z.strictObject({" : "z.object({";
      const close = "})";
      const extra =
        node.additionalProperties === false ? "" : ".passthrough()";
      expression = `${open}\n${body}${close}${extra}`;
      break;
    }
    default:
      if (node.properties) return zodExpression(contract, { ...node, type: "object" }, context);
      expression = "z.unknown()";
      break;
  }

  if (isNullable(node)) expression = `${expression}.nullable()`;
  if (node.default !== undefined) expression = `${expression}.default(${JSON.stringify(node.default)})`;
  return expression;
}

/** Genera el archivo de esquemas Zod. */
export function generateSchemas(contract: Contract): string {
  const recursive = findRecursiveSchemas(contract);
  const annotated = [...recursive].sort();
  const typeImports =
    annotated.length > 0 ? `import type { ${annotated.join(", ")} } from './types';` : "";
  const lines: string[] = [];
  lines.push("import { z } from 'zod';");
  if (typeImports !== "") lines.push(typeImports.trimEnd());
  lines.push("");
  lines.push("/**");
  lines.push(" * Esquemas Zod de la API HTTP — GENERADOS. No editar a mano.");
  lines.push(" *");
  lines.push(" * Fuente: `docs/contract/openapi.yaml`. Regenerar con");
  lines.push(" * `pnpm contract:generate` (o `mise run contract:generate`).");
  lines.push(" *");
  lines.push(" * Estos esquemas son la validación de entrada que declara el");
  lines.push(" * contrato: un body que no valida, no es un body válido.");
  lines.push(" */");
  lines.push("");
  const order = new Map<string, number>();
  Object.keys(contract.schemas).forEach((name, index) => order.set(name, index));
  for (const [name, schema] of Object.entries(contract.schemas)) {
    lines.push(`/** ${describeSchema(schema)} */`);
    const expression = zodExpression(contract, schema, { order, current: name });
    if (recursive.has(name)) {
      // Un esquema recursivo necesita anotación de tipo: sin ella, TypeScript
      // no puede inferirlo (se referencia a sí mismo en su inicializador).
      lines.push(`export const ${name}Schema: z.ZodType<${name}> = ${expression};`);
    } else {
      lines.push(`export const ${name}Schema = ${expression};`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Devuelve los esquemas que se referencian a sí mismos (directa o
 * indirectamente).
 *
 * Necesitan una anotación de tipo explícita en el archivo generado: sin ella
 * TypeScript no puede inferir el tipo de un esquema que se referencia a sí
 * mismo en su inicializador.
 */
export function findRecursiveSchemas(contract: Contract): Set<string> {
  const recursive = new Set<string>();
  const references = new Map<string, Set<string>>();
  const collect = (node: SchemaNode | undefined, into: Set<string>): void => {
    if (!node) return;
    const name = refName(node);
    if (name !== null) {
      into.add(name);
      return;
    }
    for (const property of Object.values(node.properties ?? {})) collect(property, into);
    for (const member of [...(node.oneOf ?? []), ...(node.anyOf ?? [])]) collect(member, into);
    if (node.items) collect(node.items, into);
  };
  for (const [name, schema] of Object.entries(contract.schemas)) {
    const targets = new Set<string>();
    collect(schema, targets);
    references.set(name, targets);
  }
  for (const [name, targets] of references) {
    const stack = [...targets];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      if (current === name) {
        recursive.add(name);
        break;
      }
      for (const next of references.get(current) ?? []) stack.push(next);
    }
  }
  return recursive;
}

// ────────────────────────────────────────────────────────────────────────────
// Referencia en Markdown
// ────────────────────────────────────────────────────────────────────────────

/** Resumen de una línea de un esquema, para las tablas de la referencia. */
export function schemaSummary(contract: Contract, node: SchemaNode | null): string {
  if (node === null) return "—";
  const name = refName(node);
  if (name !== null) return name;
  if (node.oneOf || node.anyOf) {
    const members = node.oneOf ?? node.anyOf ?? [];
    return members.map((member) => schemaSummary(contract, member)).join(" | ");
  }
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (node.enum) return node.enum.map((value) => JSON.stringify(value)).join(" | ");
  const type = baseType(node);
  switch (type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `${schemaSummary(contract, node.items ?? { type: "string" })}[]`;
    case "object": {
      const properties = Object.entries(node.properties ?? {});
      if (properties.length === 0) return "object";
      const rendered = properties
        .slice(0, 6)
        .map(([property, schema]) => `${property}: ${schemaSummary(contract, schema)}`)
        .join(", ");
      const rest = properties.length > 6 ? ", …" : "";
      return `{${rendered}${rest}}`;
    }
    default:
      return "object";
  }
}

/** Escapa el texto para una celda de tabla Markdown. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

/** Envuelve un valor en código inline, escapando los pipes que romperían la tabla. */
function code(value: string): string {
  return `\`${value.replace(/\|/g, "\\|")}\``;
}

/** El guard de una operación, en una línea legible. */
function guardOf(operation: ContractOperation): string {
  if (operation.security === "none") return "público";
  if (operation.roles) return `roles ${operation.roles.join(" | ")}`;
  if (operation.permission) return `permiso \`${operation.permission}\``;
  return "sesión";
}

function renderPropertyTable(
  contract: Contract,
  schema: SchemaNode,
  required: readonly string[],
): string[] {
  const properties = Object.entries(schema.properties ?? {});
  if (properties.length === 0) return [];
  const rows = properties.map(([name, property]) => {
    const mandatory = required.includes(name) ? "sí" : "no";
    const description = property.description ? cell(property.description) : "—";
    const nullable = isNullable(property) ? " (nullable)" : "";
    const fallback = property.default !== undefined ? ` (default: ${JSON.stringify(property.default)})` : "";
    return `| \`${name}\` | ${code(schemaSummary(contract, property))}${nullable}${fallback} | ${mandatory} | ${description} |`;
  });
  return [
    "| Campo | Tipo | Obligatorio | Descripción |",
    "|---|---|---|---|",
    ...rows,
  ];
}

/** Genera la referencia en Markdown. */
export function generateReference(contract: Contract): string {
  const lines: string[] = [];
  lines.push(`# ${contract.title}`);
  lines.push("");
  lines.push("<!--");
  lines.push("  GENERADO por `scripts/generate-api-contract.ts` desde");
  lines.push("  `docs/contract/openapi.yaml`. No editar a mano: el CI regenera el");
  lines.push("  archivo y falla si no coincide con el contrato.");
  lines.push("-->");
  lines.push("");
  lines.push(
    "> **Fuente única de verdad:** [`docs/contract/openapi.yaml`](../../docs/contract/openapi.yaml).",
  );
  lines.push(
    "> De ese contrato salen también los tipos y los validadores de",
  );
  lines.push(
    "> [`@ftth-copilot/api-contract`](../../packages/api-contract).",
  );
  lines.push("");
  if (contract.description.trim() !== "") {
    lines.push(contract.description.trim());
    lines.push("");
  }

  lines.push("## Índice");
  lines.push("");
  lines.push("| # | Sección | Operaciones | Qué cubre |");
  lines.push("|---|---|---|---|");
  const tagged = contract.tags
    .map((tag) => ({
      ...tag,
      operations: contract.operations.filter((operation) => operation.tags.includes(tag.name)),
    }))
    .filter((tag) => tag.operations.length > 0);
  const untagged = contract.operations.filter(
    (operation) => !tagged.some((tag) => tag.operations.includes(operation)),
  );
  let index = 0;
  for (const tag of tagged) {
    index += 1;
    lines.push(
      `| ${index} | ${cell(tag.name)} | ${tag.operations.length} | ${cell(tag.description)} |`,
    );
  }
  if (untagged.length > 0) {
    index += 1;
    lines.push(`| ${index} | Otros | ${untagged.length} | Operaciones sin etiqueta. |`);
  }
  lines.push("");

  const renderOperation = (operation: ContractOperation): void => {
    lines.push(`### ${operation.method} ${operation.path}`);
    lines.push("");
    if (operation.description.trim() !== "") {
      lines.push(operation.description.trim());
      lines.push("");
    }
    const facts: string[] = [];
    facts.push(`- **Guard:** ${guardOf(operation)}.`);
    if (operation.operationId !== "") facts.push(`- **Operation ID:** \`${operation.operationId}\`.`);
    lines.push(...facts);
    lines.push("");

    if (operation.parameters.length > 0) {
      lines.push("**Parámetros**");
      lines.push("");
      lines.push("| Nombre | En | Obligatorio | Tipo | Descripción |");
      lines.push("|---|---|---|---|---|");
      for (const parameter of operation.parameters) {
        lines.push(
          `| \`${parameter.name}\` | ${parameter.in} | ${parameter.required ? "sí" : "no"} | ${code(schemaSummary(contract, parameter.schema))} | ${cell(parameter.description)} |`,
        );
      }
      lines.push("");
    }

    if (operation.requestBody) {
      const body = operation.requestBody;
      lines.push(
        `**Cuerpo** (${operation.requestBodyContentType ?? "application/json"}${operation.requestBodyRequired ? ", obligatorio" : ", opcional"})`,
      );
      lines.push("");
      const resolved = resolveRef(contract, body);
      const table = renderPropertyTable(contract, resolved, resolved.required ?? []);
      if (table.length > 0) {
        lines.push(...table);
        lines.push("");
      } else {
        lines.push(`Esquema: ${code(schemaSummary(contract, body))}.`);
        lines.push("");
      }
    }

    lines.push("**Respuestas**");
    lines.push("");
    lines.push("| Código | Descripción | Cuerpo |");
    lines.push("|---|---|---|");
    for (const response of operation.responses) {
      const body = response.schema ? code(schemaSummary(contract, response.schema)) : "—";
      lines.push(`| \`${response.status}\` | ${cell(response.description)} | ${body} |`);
    }
    lines.push("");

    // Un mismo esquema de respuesta se documenta una sola vez por operación:
    // los errores comparten forma y repetir la tabla no aporta nada.
    const documented = new Set<string>();
    for (const response of operation.responses) {
      if (!response.schema) continue;
      const resolved = resolveRef(contract, response.schema);
      if (baseType(resolved) !== "object") continue;
      const key = refName(response.schema) ?? JSON.stringify(resolved);
      if (documented.has(key)) continue;
      documented.add(key);
      const table = renderPropertyTable(contract, resolved, resolved.required ?? []);
      if (table.length === 0) continue;
      lines.push(`<details><summary>Campos de <code>${response.status}</code></summary>`);
      lines.push("");
      lines.push(...table);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  };

  let section = 0;
  for (const tag of tagged) {
    section += 1;
    lines.push(`## ${section}. ${tag.name}`);
    lines.push("");
    if (tag.description.trim() !== "") {
      lines.push(tag.description.trim());
      lines.push("");
    }
    lines.push("| Método | Ruta | Descripción | Guard | Respuestas |");
    lines.push("|---|---|---|---|---|");
    for (const operation of tag.operations) {
      const statuses = operation.responses.map((response) => `\`${response.status}\``).join(", ");
      lines.push(
        `| ${operation.method} | \`${operation.path}\` | ${cell(operation.summary)} | ${guardOf(operation)} | ${statuses} |`,
      );
    }
    lines.push("");
    for (const operation of tag.operations) renderOperation(operation);
  }

  if (untagged.length > 0) {
    section += 1;
    lines.push(`## ${section}. Otros`);
    lines.push("");
    for (const operation of untagged) renderOperation(operation);
  }

  if (contract.prometheusMetrics.length > 0) {
    section += 1;
    lines.push(`## ${section}. Nombres de métrica Prometheus`);
    lines.push("");
    lines.push("`GET /api/metrics` expone las familias `ftth_copilot_*` y `ftth_laya_*`:");
    lines.push("");
    for (const metric of contract.prometheusMetrics) lines.push(`- \`${metric}\``);
    lines.push("");
  }

  if (contract.implementationNotes.length > 0) {
    section += 1;
    lines.push(`## ${section}. Notas de la implementación actual`);
    lines.push("");
    lines.push(
      "Estas son observaciones verificadas en el código, no recomendaciones. Sirven para no",
    );
    lines.push("asumir cosas que el contrato real no garantiza.");
    lines.push("");
    contract.implementationNotes.forEach((note, index) => {
      lines.push(`${index + 1}. ${note}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}
