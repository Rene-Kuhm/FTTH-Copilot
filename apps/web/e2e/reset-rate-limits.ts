/**
 * Limpieza de los buckets de cuota de auth entre corridas E2E.
 *
 * `auth-real.spec.ts` cuenta intentos de login/signup en la tabla
 * `authRateLimit`, claveada por IP (`login:ip:::1`, `signup:ip:::1`). Esa tabla
 * sobrevive a la corrida: sin limpiarla, la segunda ejecución del día hereda los
 * contadores y el spec muere con 429. globalSetup la limpia antes de cada
 * corrida, y sólo cuando el entorno dice explícitamente que es de test, para
 * no borrar cuotas de una base de producción por accidente.
 */

/** Operación mínima que necesitamos del cliente Prisma. */
export interface AuthQuotaCleaner {
  deleteMany(): Promise<{ count: number }>;
}

/**
 * `true` sólo cuando hay un entorno de E2E explícito y una base apuntada. El
 * bypass de auth es el marcador que el CI y el compose de test ya setean, así
 * que no hace falta una variable nueva.
 */
export function shouldResetRateLimits(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env['ENABLE_TEST_AUTH_BYPASS'] === 'true' &&
    Boolean(env['DATABASE_URL']?.trim())
  );
}

/**
 * Borra todos los buckets de cuota de auth y devuelve cuántos se borraron.
 * Fuera del entorno de test no toca nada y devuelve 0.
 */
export async function clearAuthQuotaBuckets(
  cleaner: AuthQuotaCleaner,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (!shouldResetRateLimits(env)) return 0;
  const { count } = await cleaner.deleteMany();
  return count;
}
