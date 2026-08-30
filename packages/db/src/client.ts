/**
 * Prisma client singleton (moved out of index.ts so other modules in this
 * package can import it without creating a circular import back through the
 * package barrel).
 */
import { PrismaClient } from './generated/client/index.js';

declare global {
  // eslint-disable-next-line no-var
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
