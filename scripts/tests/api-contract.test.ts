import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  compareRoutesToContract,
  extractRouteMethods,
  readApiRoutes,
  routeFileToApiPath,
} from "../lib/api-contract.ts";
import {
  generateReference,
  generateSchemas,
  generateTypes,
  parseContract,
  schemaSummary,
  zodExpression,
} from "../lib/api-contract-generator.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CONTRACT_PATH = path.join(REPO_ROOT, "docs/contract/openapi.yaml");

function contract() {
  return parseContract(fs.readFileSync(CONTRACT_PATH, "utf8"));
}

test("routeFileToApiPath convierte el archivo del handler en la ruta pública", () => {
  assert.equal(
    routeFileToApiPath("apps/web/app/api/conversations/[id]/route.ts"),
    "/api/conversations/{id}",
  );
  assert.equal(
    routeFileToApiPath("apps/web/app/api/fiber-plans/[id]/zones/[zoneId]/route.ts"),
    "/api/fiber-plans/{id}/zones/{zoneId}",
  );
  assert.equal(
    routeFileToApiPath("apps/web/app/api/auth/[...nextauth]/route.ts"),
    "/api/auth/{...nextauth}",
  );
  assert.equal(routeFileToApiPath("apps/web/app/api/health/route.ts"), "/api/health");
});

test("routeFileToApiPath rechaza un archivo fuera del árbol de la API", () => {
  assert.throws(
    () => routeFileToApiPath("apps/web/app/dashboard/page.tsx"),
    /no está bajo apps\/web\/app\/api/,
  );
});

test("extractRouteMethods ve las funciones y las constantes exportadas", () => {
  assert.deepEqual(
    extractRouteMethods("export async function GET() {}\nexport const POST = () => {};"),
    ["GET", "POST"],
  );
  assert.deepEqual(
    extractRouteMethods("export const dynamic = 'force-dynamic';\nexport async function PATCH() {}"),
    ["PATCH"],
  );
  assert.deepEqual(extractRouteMethods("export const runtime = 'nodejs';"), []);
});

test("readApiRoutes encuentra las rutas de la app web", () => {
  const routes = readApiRoutes(REPO_ROOT);
  assert.ok(routes.length > 0, "el repo tiene rutas de API");
  assert.ok(
    routes.some((route) => route.method === "GET" && route.path === "/api/health"),
    "está GET /api/health",
  );
  assert.ok(
    routes.some((route) => route.method === "DELETE" && route.path === "/api/users/{id}"),
    "está DELETE /api/users/{id}",
  );
});

test("el contrato declara exactamente las rutas que implementa el código", () => {
  const parsed = contract();
  const parity = compareRoutesToContract(
    readApiRoutes(REPO_ROOT),
    parsed.operations.map((operation) => ({
      method: operation.method as "GET",
      path: operation.path,
    })),
  );
  assert.deepEqual(parity.missingInContract, [], "toda ruta del código está en el contrato");
  assert.deepEqual(parity.missingInCode, [], "toda ruta del contrato está en el código");
});

test("compareRoutesToContract reporta las dos direcciones de la diferencia", () => {
  const parity = compareRoutesToContract(
    [
      { method: "GET", path: "/api/health", file: "apps/web/app/api/health/route.ts" },
      { method: "POST", path: "/api/nuevo", file: "apps/web/app/api/nuevo/route.ts" },
    ],
    [{ method: "GET", path: "/api/health" }, { method: "GET", path: "/api/fantasma" }],
  );
  assert.deepEqual(parity.missingInContract, ["POST /api/nuevo"]);
  assert.deepEqual(parity.missingInCode, ["GET /api/fantasma"]);
});

test("el contrato declara el guard de cada operación", () => {
  const parsed = contract();
  const chat = parsed.operations.find((operation) => operation.operationId === "postChat");
  assert.ok(chat, "existe la operación de chat");
  assert.equal(chat.permission, "chat");
  assert.equal(chat.security, "session");

  const health = parsed.operations.find((operation) => operation.operationId === "getHealth");
  assert.ok(health, "existe la operación de health");
  assert.equal(health.security, "none");

  const promote = parsed.operations.find(
    (operation) => operation.operationId === "promotePendingIncidents",
  );
  assert.ok(promote, "existe la promoción de incidentes");
  assert.deepEqual(promote.roles, ["OWNER"]);
});

test("los artefactos generados son deterministas", () => {
  const parsed = contract();
  assert.equal(generateTypes(parsed), generateTypes(contract()));
  assert.equal(generateSchemas(parsed), generateSchemas(contract()));
  assert.equal(generateReference(parsed), generateReference(contract()));
});

test("el generador traduce los esquemas a Zod con sus restricciones", () => {
  const parsed = contract();
  const chatRequest = parsed.schemas.ChatRequest;
  assert.ok(chatRequest, "el contrato declara ChatRequest");
  const expression = zodExpression(parsed, chatRequest);
  assert.match(expression, /z\.string\(\)\.min\(1\)\.max\(8000\)/);
  assert.match(expression, /conversationId: z\.string\(\)\.min\(1\)\.nullable\(\)\.optional\(\)/);
});

test("el generador traduce los enums a un z.enum cerrado", () => {
  const parsed = contract();
  const role = parsed.schemas.Role;
  assert.ok(role, "el contrato declara Role");
  assert.equal(zodExpression(parsed, role), 'z.enum(["OWNER", "ADMIN", "OPERATOR", "MEMBER"])');
});

test("el resumen de esquema escapa los pipes que romperían una tabla", () => {
  const parsed = contract();
  const health = parsed.schemas.HealthReport;
  assert.ok(health, "el contrato declara HealthReport");
  const summary = schemaSummary(parsed, health.properties?.status ?? null);
  assert.ok(summary.includes("|"), "el resumen enumera los valores");
});

test("la referencia generada lista cada operación del contrato", () => {
  const parsed = contract();
  const reference = generateReference(parsed);
  for (const operation of parsed.operations) {
    assert.ok(
      reference.includes(`### ${operation.method} ${operation.path}`),
      `la referencia documenta ${operation.method} ${operation.path}`,
    );
  }
  assert.ok(reference.includes("GENERADO por `scripts/generate-api-contract.ts`"));
});
