import { createLogger, type LogFields } from '@ftth-copilot/shared';

const log = createLogger({ name: 'http-request' });

/** Logs the HTTP outcome and request context without the body or query string. */
export function logRequest(method: string, path: string, status: number, durationMs: number, context: LogFields = {}) {
  const entry = log.child(context);
  const fields = { method, path, status, durationMs };
  if (status >= 500) entry.error('Request completed', fields);
  else if (status >= 400) entry.warn('Request completed', fields);
  else entry.info('Request completed', fields);
}
