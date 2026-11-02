/**
 * Strict redaction of secrets, tokens, credentials, and sensitive data
 * for LLM traces and telemetry spans.
 *
 * The implementation moved to `@ftth-copilot/shared`, which the structured
 * logger also needs: two redactors of secrets would diverge. This module keeps
 * the exports `agent-core` always had, with the same behaviour.
 */
export {
  REDACTED_MARKER,
  isSensitiveKey,
  redactSensitiveData,
  redactString,
} from '@ftth-copilot/shared';
