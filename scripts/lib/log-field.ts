/** Keep untrusted request fields on one line and escape terminal controls. */
export function escapeLogField(value: string): string {
  return value
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) =>
      '\\u' + character.codePointAt(0)!.toString(16).padStart(4, '0'),
    );
}

export function formatMockNmsLog(method: string, path: string, status: number): string {
  return JSON.stringify({
    method: escapeLogField(method),
    path: escapeLogField(path),
    status,
  });
}
