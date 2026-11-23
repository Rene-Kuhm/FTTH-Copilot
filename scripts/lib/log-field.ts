/** Keep untrusted request fields on one line and escape terminal controls. */
function escapeCodePoint(character: string): string {
  return '\\u' + character.codePointAt(0)!.toString(16).padStart(4, '0');
}

export function escapeLogField(value: string): string {
  return value
    .replace(/[\r\n]/g, escapeCodePoint)
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, escapeCodePoint);
}
