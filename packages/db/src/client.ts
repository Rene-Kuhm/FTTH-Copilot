/**
 * Prisma client singleton (moved out of index.ts so other modules in this
 * package can import it without creating a circular import back through the
 * package barrel).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from './generated/client/index.js';

if (typeof process !== 'undefined' && !process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), '../../.env'),
      path.resolve(currentDir, '../../../.env'),
      path.resolve(currentDir, '../../.env'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        process.loadEnvFile(candidate);
        if (process.env.DATABASE_URL) break;
      }
    }
  } catch {
    // Ignore environment loading errors in non-standard runtimes
  }
}

declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
