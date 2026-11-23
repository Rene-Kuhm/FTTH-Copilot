/**
 * Reader for snmpsim data files (`*.snmprec`).
 *
 * Each line is `OID|tag|value`, where tag `4` is an OCTET STRING. The bench
 * only needs `sysDescr`, but keeping the parser explicit is what lets
 * `lab:check` compare the value snmpsim serves against the value the capture
 * recorded, instead of against a hard-coded string that could drift.
 */

/** `sysDescr.0`, the object every capture in the manifest carries. */
export const SYS_DESCR_OID = '1.3.6.1.2.1.1.1.0';

/** ASN.1 tag of an OCTET STRING in the snmprec text format. */
const OCTET_STRING_TAG = '4';

/** LibreNMS replaces values it does not publish with this placeholder. */
const REDACTED_VALUE = '<private>';

/**
 * The `sysDescr` recorded in a capture.
 *
 * @returns the captured string, or `null` when the file has no usable
 *   `sysDescr` (absent, redacted, or not an OCTET STRING).
 */
export function parseSysDescr(content: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed === '') continue;
    const firstSeparator = trimmed.indexOf('|');
    if (firstSeparator === -1) continue;
    if (trimmed.slice(0, firstSeparator) !== SYS_DESCR_OID) continue;

    const secondSeparator = trimmed.indexOf('|', firstSeparator + 1);
    if (secondSeparator === -1) continue;
    const tag = trimmed.slice(firstSeparator + 1, secondSeparator);
    if (tag !== OCTET_STRING_TAG) return null;

    // The value is the rest of the line: it may contain `|` itself.
    const value = trimmed.slice(secondSeparator + 1);
    if (value === '' || value === REDACTED_VALUE) return null;
    return value;
  }
  return null;
}

/** The OID of the first record in a capture (useful for error messages). */
export function firstOid(content: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const separator = trimmed.indexOf('|');
    return separator === -1 ? trimmed : trimmed.slice(0, separator);
  }
  return null;
}
