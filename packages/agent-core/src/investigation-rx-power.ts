const RX_POWER_REGEX = /rx[-_ ]?power[:= ]+([+-]?\d+(?:\.\d+)?)/i;
// An unsigned match starts at the beginning of a digit run. A sign can follow a digit.
const RX_DBM_REGEX = /((?:[+-]|(?<!\d))\d+(?:\.\d+)?)\s*dBm/i;

export function parseRxPower(summary: string): number | null {
  const match = RX_POWER_REGEX.exec(summary);
  if (match) {
    const val = parseFloat(match[1]);
    if (!Number.isNaN(val)) return val;
  }
  const dbmMatch = RX_DBM_REGEX.exec(summary);
  if (dbmMatch) {
    const val = parseFloat(dbmMatch[1]);
    if (!Number.isNaN(val)) return val;
  }
  return null;
}
