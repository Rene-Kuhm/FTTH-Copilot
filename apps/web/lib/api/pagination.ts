/**
 * Cursor paging shared by the list endpoints that can grow without bound.
 *
 * Cursor rather than offset: acknowledging a row between two requests shifts
 * an offset page and silently skips one. Offset also degrades on large
 * offsets, which is precisely the case that motivated a cursor here.
 *
 * Ordering is (lastSeenAt desc, id desc). Prisma rejects `<` on enum fields, so
 * a severity-first cursor cannot be written as a typed query, and this ordering
 * lines the query up with the existing @@index([tenantId, status, lastSeenAt])
 * instead of sorting behind it.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface Cursor {
  lastSeenAt: Date;
  id: string;
}

/** Opaque cursor over the (lastSeenAt, id) ordering. */
export function encodeCursor(row: { lastSeenAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ l: row.lastSeenAt.toISOString(), i: row.id }),
    'utf8',
  ).toString('base64url');
}

/**
 * Decode a cursor, returning null for anything malformed.
 *
 * A corrupt cursor must not fail the request: the caller falls back to the
 * first page, which is better than a 400 on a value that came from a URL the
 * operator may have edited by hand.
 */
export function decodeCursor(cursor: string | null): Cursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { l?: unknown; i?: unknown };
    if (typeof parsed.l !== 'string' || typeof parsed.i !== 'string') {
      return null;
    }
    const lastSeenAt = new Date(parsed.l);
    if (Number.isNaN(lastSeenAt.getTime())) return null;
    return { lastSeenAt, id: parsed.i };
  } catch {
    return null;
  }
}

/**
 * Lexicographic continuation of (lastSeenAt desc, id desc).
 *
 * Deliberately untyped: both Incident and DetectedAlert have `lastSeenAt` and
 * `id`, but Prisma's generated where-input types are model specific, so
 * annotating it for one model makes it unusable for the other.
 */
export function cursorFilter(cursor: Cursor | null) {
  if (!cursor) return {};
  return {
    OR: [
      { lastSeenAt: { lt: cursor.lastSeenAt } },
      { lastSeenAt: cursor.lastSeenAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * Clamp a requested page size. A hostile or unparseable value falls back to
 * the default instead of reaching the database.
 */
export function clampLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, parsed);
}