/**
 * Delegation to `@ftth-copilot/ingest`.
 *
 * The durable ingest path left the Next.js process: the worker owns the
 * socket, escribe en el spool y drena por la cola de jobs.
 *
 * De la web queda sólo la lectura de los contadores: el health los usa para
 * decir qué backlog hay y qué se perdió. Los contadores que importan son los
 * del worker —los de la web están siempre en cero— y llegan en el snapshot
 * que el worker publica.
 */

export { eventIngestStats } from '@ftth-copilot/ingest';
export type { EventIngestStats } from '@ftth-copilot/ingest';
