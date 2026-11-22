/**
 * Guarda de regresión Edge para `apps/web/middleware.ts`.
 *
 * En Next.js 16.3.8 `middleware.ts` compila al runtime Edge (sin TCP, sin
 * `process.version` y sin APIs de Node.js). Si un módulo Node-only entra en su
 * grafo de imports —como ocurrió cuando `middleware/rate-limit.ts` importó
 * `lib/rate-limit-store.ts` → `ioredis` → `redis-errors`— toda petición falla
 * con `TypeError: Cannot read properties of undefined (reading 'charCodeAt')`.
 *
 * Puntos ciegos declarados de este análisis estático:
 * - No se recorren dependencias externas (paquetes dentro de `node_modules`):
 *   sólo los archivos del repo alcanzables por imports relativos y `@/`.
 * - Los imports dinámicos (`import(...)` / `require(...)`) sólo se detectan
 *   cuando el specifier es un literal de string.
 * - La regla `node:*` es por prefijo: bloquea cualquier builtin de Node,
 *   incluidos los que el runtime Edge llegue a tolerar; es deliberado porque el
 *   grafo Edge del middleware hoy no importa ningún `node:*` (usa Web APIs:
 *   `globalThis.crypto` en `lib/auth/csrf.ts` y `jose` en
 *   `middleware/jwt-verify.ts`).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const WEB_ROOT = resolve(__dirname, '../..');
const MIDDLEWARE_ENTRY = resolve(WEB_ROOT, 'middleware.ts');

const NODE_ONLY_MODULES = [
  // Paquetes Node-only (directos e indirectos del repo)
  'ioredis',
  'bullmq',
  'pg',
  'mysql2',
  'knex',
  'mongoose',
  '@prisma/client',
  'prisma',
  'jsonwebtoken',
  'sharp',
  '@ftth-copilot/db',
  '@ftth-copilot/jobs',
  '@ftth-copilot/shared',
  // Builtins de Node sin prefijo `node:` (los `node:*` se bloquean por prefijo)
  'net',
  'tls',
  'fs',
  'crypto',
  'child_process',
  'worker_threads',
  'http',
  'https',
  'dgram',
  'dns',
  'os',
  'path',
  'stream',
] as const;

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx'] as const;

function isFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveInternalImport(fromFile: string, specifier: string): string | null {
  let candidateBase: string | null = null;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    candidateBase = resolve(dirname(fromFile), specifier);
  } else if (specifier.startsWith('@/')) {
    candidateBase = resolve(WEB_ROOT, specifier.slice(2));
  }

  if (!candidateBase) return null;

  if (isFile(candidateBase)) {
    return candidateBase;
  }
  for (const ext of SOURCE_EXTENSIONS) {
    if (isFile(`${candidateBase}${ext}`)) {
      return `${candidateBase}${ext}`;
    }
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const indexFile = resolve(candidateBase, `index${ext}`);
    if (isFile(indexFile)) {
      return indexFile;
    }
  }
  return null;
}

function isTypeOnlyNamedImport(clause: ts.ImportClause): boolean {
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  if (!clause.namedBindings) return false;
  if (ts.isNamedImports(clause.namedBindings)) {
    return clause.namedBindings.elements.every((el) => el.isTypeOnly);
  }
  return false;
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    return node.exportClause.elements.every((el) => el.isTypeOnly);
  }
  return false;
}

function extractRuntimeSpecifiers(filePath: string): string[] {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause || !isTypeOnlyNamedImport(node.importClause)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !isTypeOnlyExport(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (
        (isDynamicImport || isRequire) &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]!)
      ) {
        specifiers.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

interface BlockedMatch {
  rule: string;
  reason: string;
}

function matchesBlockedModule(specifier: string): BlockedMatch | undefined {
  if (specifier.startsWith('node:')) {
    return {
      rule: 'node:*',
      reason:
        'builtin de Node.js por prefijo node:* (regla conservadora: el grafo Edge del middleware no admite ningún node:* y debe usar Web APIs como globalThis.crypto o jose)',
    };
  }

  const matched = NODE_ONLY_MODULES.find(
    (blocked) => specifier === blocked || specifier.startsWith(`${blocked}/`),
  );
  if (matched) {
    return {
      rule: matched,
      reason: `módulo/paquete Node-only (${matched})`,
    };
  }
  return undefined;
}

interface GraphViolation {
  rule: string;
  reason: string;
  specifier: string;
  file: string;
  chain: string[];
}

function findNodeOnlyImportsInMiddlewareGraph(): GraphViolation[] {
  const visited = new Set<string>();
  const violations: GraphViolation[] = [];

  const walk = (filePath: string, chain: string[]): void => {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    const relFile = relative(WEB_ROOT, filePath);
    const currentChain = [...chain, relFile];

    for (const specifier of extractRuntimeSpecifiers(filePath)) {
      const blocked = matchesBlockedModule(specifier);
      if (blocked) {
        violations.push({
          rule: blocked.rule,
          reason: blocked.reason,
          specifier,
          file: relFile,
          chain: currentChain,
        });
        continue;
      }

      const resolved = resolveInternalImport(filePath, specifier);
      if (resolved && resolved.startsWith(WEB_ROOT)) {
        walk(resolved, currentChain);
      }
    }
  };

  walk(MIDDLEWARE_ENTRY, []);
  return violations;
}

describe('Edge compatibility del middleware', () => {
  it('el grafo de imports de apps/web/middleware.ts no incluye builtins node:* ni módulos Node-only', () => {
    const violations = findNodeOnlyImportsInMiddlewareGraph();

    const message = violations
      .map(
        (v) =>
          `- Módulo prohibido "${v.specifier}" (${v.reason}; regla: ${v.rule}) importado en ${v.file} [cadena: ${v.chain.join(' -> ')}]`,
      )
      .join('\n');

    expect(violations, message).toEqual([]);
  });

  it('demuestra el mecanismo de fallo en Edge: ioredis lanza TypeError de charCodeAt si process.version es undefined', async () => {
    const require = createRequire(import.meta.url);
    const ioredisEntry = require.resolve('ioredis', { paths: [WEB_ROOT] });
    const redisErrorsEntry = require.resolve('redis-errors', {
      paths: [dirname(ioredisEntry)],
    });

    // Asegura reevaluación limpia del scope de módulo en cada corrida.
    vi.resetModules();
    for (const cacheKey of Object.keys(require.cache)) {
      if (
        cacheKey === ioredisEntry ||
        cacheKey === redisErrorsEntry ||
        cacheKey.includes('/ioredis/') ||
        cacheKey.includes('/redis-errors/')
      ) {
        delete require.cache[cacheKey];
      }
    }

    const originalVersionDescriptor = Object.getOwnPropertyDescriptor(
      process,
      'version',
    );
    let caught: unknown;

    try {
      Object.defineProperty(process, 'version', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      try {
        require(ioredisEntry);
      } catch (error) {
        caught = error;
      }
    } finally {
      if (originalVersionDescriptor) {
        Object.defineProperty(process, 'version', originalVersionDescriptor);
      }
      // Limpia cualquier módulo cargado parcialmente bajo process.version = undefined.
      for (const cacheKey of Object.keys(require.cache)) {
        if (
          cacheKey === ioredisEntry ||
          cacheKey === redisErrorsEntry ||
          cacheKey.includes('/ioredis/') ||
          cacheKey.includes('/redis-errors/')
        ) {
          delete require.cache[cacheKey];
        }
      }
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as TypeError).message).toContain('charCodeAt');
  });
});
