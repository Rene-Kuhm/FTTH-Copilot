/**
 * Pure helpers for the cognitive-investigation feedback API (Fase 1).
 *
 * This module MUST stay free of any Prisma / Next.js / cookie imports so
 * it can be unit-tested under vitest without DB. Any persistence layer
 * (POST/GET route handlers) consumes these functions and is responsible
 * for tenant scoping and audit.
 */

/** Closed enum for Fase 1. Phase 5 may extend with 'maintenance' under a
 *  separate spec change that includes a Prisma migration. */
export const FEEDBACK_LABELS = ['confirmed', 'incorrect', 'insufficient_data'] as const;
export type FeedbackLabel = (typeof FEEDBACK_LABELS)[number];

export function isFeedbackLabel(value: unknown): value is FeedbackLabel {
  return typeof value === 'string' && (FEEDBACK_LABELS as readonly string[]).includes(value);
}

/** Cap applied to every free-text field so a malicious technician cannot
 *  inflate the row size and pressure the DB. */
export const FREE_TEXT_MAX_BYTES = 4 * 1024;

const UTF8 = new TextEncoder();

/** Returns `value` truncated (by bytes, not characters) if it exceeds the
 *  cap. Returns `null` when `value` is null or empty. */
export function clampFreeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const bytes = UTF8.encode(trimmed);
  if (bytes.byteLength <= FREE_TEXT_MAX_BYTES) return trimmed;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, FREE_TEXT_MAX_BYTES));
}

/** Idempotency fingerprint key: the @@unique constraint on the model is
 *  exactly this tuple, so the helper is authoritative — if two POSTs
 *  produce the same key, they MUST collapse to the same row. */
export function buildIdempotencyKey(
  tenantId: string,
  runId: string,
  versionId: string,
  authorUserId: string,
  label: FeedbackLabel,
): string {
  return `${tenantId}\u0001${runId}\u0001${versionId}\u0001${authorUserId}\u0001${label}`;
}

/** Stable feedbackId generator. The prefix distinguishes feedback rows
 *  from other Investigation* identifiers; the suffix is URL-safe and
 *  does not collide with runs (`r_…`) or versions (`v_…`). */
export function generateFeedbackId(): string {
  // crypto.randomUUID is available in Node 18+; matches the rest of
  // the codebase's identifier-generation strategy.
  const u = globalThis.crypto.randomUUID();
  return `f_${u.replace(/-/g, '')}`;
}

/** Map a feedback label to a coarse human-readable phrase used by the
 *  UI to confirm the operator's intent before submission. The mapping
 *  is intentionally narrow: any new label needs a spec change. */
export const LABEL_PROMPT: Record<FeedbackLabel, string> = {
  confirmed: 'Confirm that the diagnosis is correct',
  incorrect: 'Mark the diagnosis as incorrect',
  insufficient_data: 'Mark that there was not enough data',
};
