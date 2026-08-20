/**
 * Simple request logger for API routes.
 * Logs method, path, status, and duration.
 */
export function logRequest(method: string, path: string, status: number, durationMs: number) {
  const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
  console.log(`[${level}] ${method} ${path} ${status} ${durationMs}ms`);
}
