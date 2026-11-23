/**
 * PASS/FAIL rendering of the virtual bench smoke test.
 *
 * The output is the contract of `pnpm lab:check`: one line per check with the
 * observed value, a closing count, and a non-zero exit code as soon as a single
 * check fails. Formatting lives here so it can be tested without Docker.
 */

export interface CheckResult {
  /** Stable identifier, e.g. `bbsim-rest`. */
  readonly name: string;
  readonly ok: boolean;
  /** What was observed: the value read back, or the error. */
  readonly detail: string;
}

export interface CheckSummary {
  readonly passed: number;
  readonly failed: number;
  readonly line: string;
  /** `0` only when every check passed. */
  readonly exitCode: number;
}

/** One rendered line: `[PASS] bbsim-rest: ...` or `[FAIL] ...`. */
export function formatCheckResult(result: CheckResult): string {
  const status = result.ok ? '[PASS]' : '[FAIL]';
  const detail = result.detail.trim().replace(/\s*\n\s*/g, ' ');
  return `${status} ${result.name}: ${detail}`;
}

/** Closing counters plus the exit code the process must use. */
export function summarize(results: readonly CheckResult[]): CheckSummary {
  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  return {
    passed,
    failed,
    line: `${passed} passed, ${failed} failed`,
    exitCode: failed === 0 && results.length > 0 ? 0 : 1,
  };
}

/** Detail text for a failed HTTP/DNS/UDP probe. */
export function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
