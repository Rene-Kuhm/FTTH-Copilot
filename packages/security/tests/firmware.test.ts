import { describe, it, expect } from 'vitest';
import { detectVulnerableFirmware } from '../src/firmware';

const NOW = 1_752_000_000_000;

describe('detectVulnerableFirmware', () => {
  it('flags a device with known-vulnerable firmware', () => {
    const findings = detectVulnerableFirmware(
      [{ deviceKind: 'ONU', deviceId: 'onu-1', firmwareVersion: 'V3R019C10S135' }],
      ['V3R019C10S135'],
      { now: NOW },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('vulnerable_firmware');
    expect(findings[0]!.severity).toBe('critical');
  });

  it('does not flag firmware not in the vulnerable list', () => {
    const findings = detectVulnerableFirmware(
      [{ deviceKind: 'ONU', deviceId: 'onu-1', firmwareVersion: 'V2.0.0P3' }],
      ['V3R019C10S135'],
      { now: NOW },
    );
    expect(findings).toEqual([]);
  });

  it('skips devices with null firmware', () => {
    const findings = detectVulnerableFirmware(
      [{ deviceKind: 'ONU', deviceId: 'onu-1', firmwareVersion: null }],
      ['V3R019C10S135'],
      { now: NOW },
    );
    expect(findings).toEqual([]);
  });

  it('flags only the matching devices', () => {
    const findings = detectVulnerableFirmware(
      [
        { deviceKind: 'ONU', deviceId: 'onu-1', firmwareVersion: 'V3R019C10S135' },
        { deviceKind: 'ONU', deviceId: 'onu-2', firmwareVersion: 'V2.0.0P3' },
        { deviceKind: 'OLT', deviceId: 'olt-1', firmwareVersion: 'V3R019C10S135' },
      ],
      ['V3R019C10S135'],
      { now: NOW },
    );
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.id).sort()).toEqual([
      'vulnerable-firmware-OLT-olt-1',
      'vulnerable-firmware-ONU-onu-1',
    ]);
  });
});
