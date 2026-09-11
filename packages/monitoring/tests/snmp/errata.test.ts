import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  loadErrataRegistry,
  evaluateSnmpErrata,
  processSnmpNotification,
  type SnmpErrataRecord,
  type DecodedSnmpNotification,
  type RawSnmpEvidenceEnvelope,
  type SnmpSenderContext,
} from '../../src';

describe('OLT Errata Registry & False-Positive Rule Management (Roadmap Fase 8)', () => {
  it('loads and parses canonical research/olt/errata.yaml with 0 errors', () => {
    const errataPath = path.resolve(__dirname, '../../../../research/olt/errata.yaml');
    const { erratas, errors } = loadErrataRegistry(errataPath);

    expect(errors).toHaveLength(0);
    expect(erratas.length).toBeGreaterThanOrEqual(4);

    const hwErrata = erratas.find((e) => e.errata_id === 'ERR-HW-001');
    expect(hwErrata).toBeDefined();
    expect(hwErrata?.vendor).toBe('Huawei');
    expect(hwErrata?.action).toBe('suppress');
  });

  it('matches errata rule and returns suppress action', () => {
    const rules: SnmpErrataRecord[] = [
      {
        errata_id: 'ERR-TEST-001',
        vendor: 'Huawei',
        target_models: ['MA5600'],
        firmware_versions: ['V800R018'],
        oid: '1.3.6.1.4.1.2011.6.128.1.1.2.99.1',
        action: 'suppress',
        reason: 'Known test trap',
      },
    ];

    const match = evaluateSnmpErrata(
      {
        oid: '1.3.6.1.4.1.2011.6.128.1.1.2.99.1',
        vendor: 'Huawei',
        model: 'MA5600T',
        firmware: 'V800R018C00',
      },
      rules,
    );

    expect(match.matched).toBe(true);
    expect(match.action).toBe('suppress');
    expect(match.errata?.errata_id).toBe('ERR-TEST-001');
  });

  it('does not match errata rule when firmware or model differs', () => {
    const rules: SnmpErrataRecord[] = [
      {
        errata_id: 'ERR-TEST-002',
        vendor: 'ZTE',
        target_models: ['C300'],
        firmware_versions: ['V1.2'],
        oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1.99.9',
        action: 'suppress',
        reason: 'ZTE test trap',
      },
    ];

    const match = evaluateSnmpErrata(
      {
        oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1.99.9',
        vendor: 'ZTE',
        model: 'C300',
        firmware: 'V2.1.0', // Different firmware version!
      },
      rules,
    );

    expect(match.matched).toBe(false);
    expect(match.action).toBe('none');
  });

  it('applies remap action to category and severity', () => {
    const rules: SnmpErrataRecord[] = [
      {
        errata_id: 'ERR-NOK-001',
        vendor: 'Nokia',
        oid: '1.3.6.1.4.1.637.61.1.36.1.1.1.1.1.99.1',
        action: 'remap',
        remap_category: 'config_change',
        remap_severity: 'info',
        reason: 'Card power-cycle diagnostic',
      },
    ];

    const match = evaluateSnmpErrata(
      {
        oid: '1.3.6.1.4.1.637.61.1.36.1.1.1.1.1.99.1',
        vendor: 'Nokia',
      },
      rules,
    );

    expect(match.matched).toBe(true);
    expect(match.action).toBe('remap');
    expect(match.remappedCategory).toBe('config_change');
    expect(match.remappedSeverity).toBe('info');
  });

  it('tags telemetry event in processSnmpNotification when errata matches', () => {
    const rules: SnmpErrataRecord[] = [
      {
        errata_id: 'ERR-HW-001',
        vendor: 'Huawei',
        oid: '1.3.6.1.4.1.2011.6.128.1.1.2.99.1',
        action: 'suppress',
        reason: 'Spurious keepalive',
      },
    ];

    const notification: DecodedSnmpNotification = {
      senderIp: '10.0.0.1',
      version: '2c',
      pduType: 'TrapV2',
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.99.1',
      sysUpTime: 12345,
      varbinds: [],
      receivedAtMs: Date.now(),
    };

    const senderContext: SnmpSenderContext = {
      tenantId: 'tenant-test',
      deviceId: 'huawei-olt-01',
      deviceKind: 'OLT',
      vendorHint: 'Huawei',
    };

    const evidence: RawSnmpEvidenceEnvelope = {
      evidenceId: 'ev-test-01',
      schema: 'snmp.evidence.raw.v1',
      receivedAt: new Date().toISOString(),
      senderIp: '10.0.0.1',
      version: '2c',
      pduType: 'TrapV2',
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.99.1',
      varbinds: [],
      fingerprint: 'fp-test-01',
    };

    const result = processSnmpNotification(notification, senderContext, evidence, {
      errataRules: rules,
    });

    expect(result.errata?.matched).toBe(true);
    expect(result.errata?.action).toBe('suppress');
    expect(result.event.tags?.errata_action).toBe('suppressed');
    expect(result.event.tags?.errata_id).toBe('ERR-HW-001');
    expect(result.event.tags?.errata_reason).toBe('Spurious keepalive');
  });
});
