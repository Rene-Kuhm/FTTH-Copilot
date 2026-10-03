import { describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { DzsOltAdapter } from '../../src/snmp/adapter/dzs';
import { setSimulatorProvisionalTraps } from '../../src/snmp/catalog';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type {
  DecodedSnmpNotification,
  RawSnmpEvidenceEnvelope,
} from '../../src/snmp/types';

describe('ODN Hint Pipeline Integration (Fase ODN-2)', () => {
  // Provisional traps must be enabled to surface DZS trap definitions
  beforeAllEnablingProvisionalTraps();

  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-odn',
    connectionId: 'conn-odn-01',
    oltId: 'mxk-819-core',
    vendor: 'DZS',
    pen: 5504,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-odn-1',
    receivedAt: '2026-09-15T12:00:00.000Z',
    senderIp: '10.100.5.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.5504.5.14.2.1.2',
    sysUpTime: 120500,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-odn-fingerprint',
  };

  const adapter = new DzsOltAdapter();

  it('attaches extracted ODN hints to TelemetryEvent.metrics.odnHints', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.5504.5.14.10.50.1',
          type: 'OctetString',
          value: 'SPL-NORTE-01',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.metrics).toBeDefined();
    expect(event.metrics?.['odnHints']).toBeDefined();

    const hints = event.metrics?.['odnHints'] as Array<{
      kind: string;
      candidateId: string;
      confidence: string;
    }>;
    expect(hints).toHaveLength(1);
    expect(hints[0]?.kind).toBe('SPLITTER');
    expect(hints[0]?.candidateId).toBe('SPL-NORTE-01');
    expect(hints[0]?.confidence).toBe('high');
  });

  it('does NOT attach odnHints field when no hints are found', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.5504.5.14.1.1.1',
          type: 'OctetString',
          value: 'DZSA12345678', // serial, not an ODN ID
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    // odnHints key may be absent or empty array — either is acceptable
    const hints = event.metrics?.['odnHints'];
    expect(hints === undefined || (Array.isArray(hints) && hints.length === 0)).toBe(true);
  });

  it('attaches multiple hints from varbinds referencing distinct components', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.5504.5.14.10.50.1', type: 'OctetString', value: 'SPL-001' },
        { oid: '1.3.6.1.4.1.5504.5.14.10.60.1', type: 'OctetString', value: 'ODB-NORTE' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    const hints = event.metrics?.['odnHints'] as Array<{ kind: string }>;
    expect(hints).toHaveLength(2);
    const kinds = hints.map((h) => h.kind).sort();
    expect(kinds).toEqual(['NAP', 'SPLITTER']);
  });

  it('adds odnHintKinds tag summarising hint kinds and candidate ids', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.5504.5.14.1.1.2.43.50.1', type: 'OctetString', value: 'CTO-NORTE-12' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.tags?.['odnHintKinds']).toContain('CTO:CTO-NORTE-12');
  });

  it('preserves the adapter-emitted deviceKind and deviceId alongside ODN hints', () => {
    // Note: The DZS adapter has its own internal serial detection that matches
    // any varbind value with length >= 8 inside an OID containing '5504.5.14'.
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.1',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.5504.5.14.1.1.1', type: 'OctetString', value: 'DZSA12345678' },
        // ODN identifier inside the same 5504.5.14 subtree the serial scanner
        // used to over-match. It must not be mistaken for an ONT serial.
        { oid: '1.3.6.1.4.1.5504.5.14.10.50.1', type: 'OctetString', value: 'CTO-NORTE-12' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    // Adapter's primary signal (deviceKind=ONU for an ONT trap) is preserved
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('DZSA12345678');

    // ODN hint is present and tagged separately, even though it came from a
    // non-vendor-specific OID namespace.
    const hints = event.metrics?.['odnHints'] as Array<{ kind: string }>;
    expect(hints).toHaveLength(1);
    expect(hints[0]?.kind).toBe('CTO');
    expect(hints[0]?.candidateId).toBe('CTO-NORTE-12');
  });

  it('hint attachments never elevate severity or override trap category', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.20',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.5504.5.14.10.50.1', type: 'OctetString', value: 'SPL-PRIMARY' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    // Adapter sets deviceKind=OLT for pon_down trap; severity comes from catalog
    expect(event.deviceKind).toBe('OLT');
    expect(event.metrics?.['severity']).toBe('critical');
    expect(event.metrics?.['trapCategory']).toBe('pon_down');

    // ODN hints are advisory metadata, not a signal change
    const hints = event.metrics?.['odnHints'] as Array<{ kind: string }>;
    expect(hints[0]?.kind).toBe('SPLITTER');
  });

  it('attaches FDH hint with medium confidence', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.20',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.5504.5.14.10.fdh.1', type: 'OctetString', value: 'FDH-NORTE' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    const hints = event.metrics?.['odnHints'] as Array<{ confidence: string }>;
    expect(hints[0]?.confidence).toBe('medium');
  });
});

// Vitest's `beforeAll` is hoisted at the file level; use a regular function helper
// here so we keep the test description in plain English.
function beforeAllEnablingProvisionalTraps() {
  // no-op description; the actual beforeAll is registered at module level below
}

import { beforeAll } from 'vitest';

beforeAll(() => {
  setSimulatorProvisionalTraps(true);
});
