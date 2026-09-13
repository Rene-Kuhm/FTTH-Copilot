import { prisma } from '@ftth-copilot/db';

export interface DatabaseHealthResult {
  status: 'connected' | 'error';
  latencyMs: number;
  error?: string;
}

/**
 * Executes a bounded database connectivity check.
 * Times out after `timeoutMs` (default 2000ms) to ensure health endpoint remains responsive.
 */
export async function checkDatabaseHealth(timeoutMs = 2000): Promise<DatabaseHealthResult> {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const queryPromise = prisma.$queryRaw`SELECT 1`;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Database health check timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      await Promise.race([queryPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    return {
      status: 'connected',
      latencyMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error && err.message.includes('timed out');
    if (!isTimeout) {
      console.error('[DatabaseHealth] check failed:', err);
    }

    return {
      status: 'error',
      latencyMs: Date.now() - start,
      error: isTimeout ? 'Database check timed out' : 'Database connection error',
    };
  }
}
