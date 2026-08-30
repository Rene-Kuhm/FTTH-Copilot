import type { SecurityFinding } from './types';

export interface DeviceFirmware {
  deviceKind: 'OLT' | 'ONU';
  deviceId: string;
  firmwareVersion: string | null;
}

export interface FirmwareDetectorOptions {
  now?: number;
}

/**
 * Flags devices running a known-vulnerable firmware version. `vulnerable` is an
 * explicit allowlist of exact versions with known CVEs (kept external so the
 * list can be updated without changing the detector).
 */
export function detectVulnerableFirmware(
  devices: DeviceFirmware[],
  vulnerable: string[],
  opts: FirmwareDetectorOptions = {},
): SecurityFinding[] {
  const now = opts.now ?? Date.now();
  const vulnerableSet = new Set(vulnerable);
  const findings: SecurityFinding[] = [];

  for (const device of devices) {
    const version = device.firmwareVersion;
    if (!version || !vulnerableSet.has(version)) continue;

    findings.push({
      id: `vulnerable-firmware-${device.deviceKind}-${device.deviceId}`,
      kind: 'vulnerable_firmware',
      severity: 'critical',
      sourceIp: null,
      title: `Firmware vulnerable en ${device.deviceId}`,
      description: `${device.deviceKind} ${device.deviceId} corre firmware ${version}, con CVE conocidas.`,
      detectedAt: new Date(now).toISOString(),
    });
  }

  return findings;
}
