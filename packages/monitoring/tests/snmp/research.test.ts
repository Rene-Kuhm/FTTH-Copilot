import { describe, expect, it } from 'vitest';
import {
  validateSourcesList,
  validateCompatibilityRecord,
  validateCrossVendorRegistry,
  validateCatalogFactsTraceability,
} from '../../src/snmp/research/validator';
import type { SnmpTrapDefinition } from '../../src/snmp/catalog';

describe('OLT Research Sources & Compatibility Validator (Roadmap Fase 1)', () => {
  const validSource = {
    source_id: 'huawei-ma5800-gpon-alarm-001',
    vendor: 'Huawei',
    families: ['MA5800'],
    firmware: 'unknown',
    title: 'HUAWEI-GPON-MIB Alarm Definitions',
    publisher: 'Huawei',
    url: 'https://support.huawei.com/enterprise/en/doc/EDOC1100000001',
    source_grade: 'B' as const,
    retrieved_at: '2026-09-10',
    license: 'review-required' as const,
    sha256: null,
    facts: [
      {
        notification_name: 'hwGponOntDyingGasp',
        oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43',
        status: 'provisional' as const,
        severity: 'major',
        category: 'dying_gasp',
      },
    ],
  };

  it('validates a compliant sources list without errors', () => {
    const result = validateSourcesList([validSource]);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.type === 'error')).toHaveLength(0);
  });

  it('rejects invalid source_grade or malformed source_id', () => {
    const invalidSource = {
      ...validSource,
      source_id: 'Invalid_UPPERCASE_ID',
      source_grade: 'Z', // invalid grade
    };

    const result = validateSourcesList([invalidSource]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('kebab-case'))).toBe(true);
  });

  it('detects duplicate source_ids within the same file', () => {
    const duplicateList = [validSource, { ...validSource, title: 'Second copy' }];
    const result = validateSourcesList(duplicateList);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('Duplicate source_id'))).toBe(true);
  });

  it('validates a compliant vendor compatibility record', () => {
    const validCompat = {
      vendor: 'Huawei',
      priority: 'P0' as const,
      iana_pens: [2011],
      families: [
        {
          family: 'MA5800',
          level: 'L2' as const,
          confidence_grade: 'B' as const,
          firmware: 'unknown',
          supported_traps: ['hwGponOntDyingGasp'],
          sources: ['huawei-ma5800-gpon-alarm-001'],
        },
      ],
    };

    const result = validateCompatibilityRecord(validCompat);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid support level (outside L0-L4)', () => {
    const invalidCompat = {
      vendor: 'Huawei',
      priority: 'P0' as const,
      iana_pens: [2011],
      families: [
        {
          family: 'MA5800',
          level: 'L9', // invalid level
          confidence_grade: 'B' as const,
          firmware: 'unknown',
          supported_traps: [],
          sources: [],
        },
      ],
    };

    const result = validateCompatibilityRecord(invalidCompat);
    expect(result.valid).toBe(false);
  });

  it('cross-validates cross-vendor registry detecting broken references and duplicate IDs', () => {
    const pkgA = {
      vendorId: 'huawei',
      sources: [validSource],
      compatibility: {
        vendor: 'Huawei',
        priority: 'P0' as const,
        iana_pens: [2011],
        families: [
          {
            family: 'MA5800',
            level: 'L2' as const,
            confidence_grade: 'B' as const,
            firmware: 'unknown',
            supported_traps: ['hwGponOntDyingGasp'],
            sources: ['huawei-ma5800-gpon-alarm-001'],
          },
        ],
      },
    };

    const pkgB = {
      vendorId: 'zte',
      sources: [
        {
          ...validSource,
          source_id: 'huawei-ma5800-gpon-alarm-001', // Colliding ID in another vendor!
          vendor: 'ZTE',
        },
      ],
      compatibility: {
        vendor: 'ZTE',
        priority: 'P0' as const,
        iana_pens: [3902],
        families: [
          {
            family: 'C300',
            level: 'L1' as const,
            confidence_grade: 'B' as const,
            firmware: 'unknown',
            supported_traps: [],
            sources: ['nonexistent-source-ref'], // Broken reference!
          },
        ],
      },
    };

    const crossResult = validateCrossVendorRegistry([pkgA, pkgB]);
    expect(crossResult.valid).toBe(false);
    expect(crossResult.issues.some((i) => i.message.includes('Cross-vendor duplicate'))).toBe(true);
    expect(crossResult.issues.some((i) => i.message.includes('nonexistent-source-ref'))).toBe(true);
  });

  describe('validateCatalogFactsTraceability', () => {
    const mockPackages = [
      {
        vendorId: 'huawei',
        sources: [validSource],
        compatibility: {
          vendor: 'Huawei',
          priority: 'P0' as const,
          iana_pens: [2011],
          families: [],
        },
      },
    ];

    it('passes when non-standard catalog trap matches source facts', () => {
      const catalog: SnmpTrapDefinition[] = [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43',
          name: 'hwGponOntDyingGasp',
          category: 'dying_gasp',
          severity: 'major',
          vendor: 'Huawei',
          description: 'Dying gasp',
          source_id: 'huawei-ma5800-gpon-alarm-001',
        },
      ];

      const result = validateCatalogFactsTraceability(mockPackages, catalog);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('skips standard RFC traps without requiring source facts', () => {
      const catalog: SnmpTrapDefinition[] = [
        {
          oid: '1.3.6.1.6.3.1.1.5.1',
          name: 'coldStart',
          category: 'restart',
          severity: 'info',
          vendor: 'Standard',
          description: 'Cold start',
        },
      ];

      const result = validateCatalogFactsTraceability(mockPackages, catalog);
      expect(result.valid).toBe(true);
    });

    it('detects catalog traps citing nonexistent source_id', () => {
      const catalog: SnmpTrapDefinition[] = [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.99',
          name: 'hwUnknownAlarm',
          category: 'unknown_trap',
          severity: 'warning',
          vendor: 'Huawei',
          description: 'Unknown alarm',
          source_id: 'nonexistent-source-id',
        },
      ];

      const result = validateCatalogFactsTraceability(mockPackages, catalog);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.message.includes('not registered in any vendor package'))).toBe(true);
    });

    it('detects catalog traps citing source_id that lacks the OID in its facts', () => {
      const catalog: SnmpTrapDefinition[] = [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.99', // OID not in validSource facts
          name: 'hwMissingFactAlarm',
          category: 'los',
          severity: 'critical',
          vendor: 'Huawei',
          description: 'Alarm with missing fact',
          source_id: 'huawei-ma5800-gpon-alarm-001',
        },
      ];

      const result = validateCatalogFactsTraceability(mockPackages, catalog);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.message.includes('OID is missing from source facts'))).toBe(true);
    });

    it('detects name mismatch between catalog and source facts', () => {
      const catalog: SnmpTrapDefinition[] = [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43',
          name: 'hwWrongName',
          category: 'dying_gasp',
          severity: 'major',
          vendor: 'Huawei',
          description: 'Dying gasp',
          source_id: 'huawei-ma5800-gpon-alarm-001',
        },
      ];

      const result = validateCatalogFactsTraceability(mockPackages, catalog);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.message.includes('name mismatch'))).toBe(true);
    });

    it('detects category mismatch between catalog and source facts', () => {
      const catalog: SnmpTrapDefinition[] = [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43',
          name: 'hwGponOntDyingGasp',
          category: 'los', // Mismatch: fact is dying_gasp
          severity: 'major',
          vendor: 'Huawei',
          description: 'Dying gasp',
          source_id: 'huawei-ma5800-gpon-alarm-001',
        },
      ];

      const result = validateCatalogFactsTraceability(mockPackages, catalog);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.message.includes('category'))).toBe(true);
    });

    it('detects severity mismatch between catalog and source facts', () => {
      const catalog: SnmpTrapDefinition[] = [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43',
          name: 'hwGponOntDyingGasp',
          category: 'dying_gasp',
          severity: 'critical', // Mismatch: fact is major
          vendor: 'Huawei',
          description: 'Dying gasp',
          source_id: 'huawei-ma5800-gpon-alarm-001',
        },
      ];

      const result = validateCatalogFactsTraceability(mockPackages, catalog);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.message.includes('severity'))).toBe(true);
    });

    it('detects status mismatch between catalog and source facts', () => {
      const catalog: SnmpTrapDefinition[] = [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43',
          name: 'hwGponOntDyingGasp',
          category: 'dying_gasp',
          severity: 'major',
          vendor: 'Huawei',
          description: 'Dying gasp',
          source_id: 'huawei-ma5800-gpon-alarm-001',
          status: 'recognized', // Mismatch: validSource fact is provisional
        },
      ];

      const result = validateCatalogFactsTraceability(mockPackages, catalog);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.message.includes('status'))).toBe(true);
    });
  });
});
