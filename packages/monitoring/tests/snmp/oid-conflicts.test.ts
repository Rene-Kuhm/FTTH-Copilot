import { describe, it, expect } from 'vitest';
import {
  detectOidConflicts,
  type SnmpTrapDefinition,
  type VendorPackageContent,
} from '../../src';

describe('OID Collision & Semantic Conflict Detector (Roadmap Fase 8)', () => {
  it('passes on an empty or cleanly partitioned registry', () => {
    const report = detectOidConflicts([], []);
    expect(report.valid).toBe(true);
    expect(report.conflicts).toHaveLength(0);
  });

  it('detects semantic mismatch when catalog has conflicting definitions for the same OID', () => {
    const conflictingCatalog: SnmpTrapDefinition[] = [
      {
        oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
        name: 'hwGponOntDyingGasp',
        category: 'dying_gasp',
        severity: 'critical',
        vendor: 'Huawei',
        description: 'Dying gasp',
      },
      {
        oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
        name: 'hwGponOntDyingGaspBogus',
        category: 'restart', // conflicting category!
        severity: 'info',     // conflicting severity!
        vendor: 'Huawei',
        description: 'Contradictory duplicate',
      },
    ];

    const report = detectOidConflicts([], conflictingCatalog);
    expect(report.valid).toBe(false);
    const issue = report.conflicts.find((c) => c.category === 'semantic_mismatch');
    expect(issue).toBeDefined();
    expect(issue?.type).toBe('error');
    expect(issue?.oid).toBe('1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14');
  });

  it('detects PEN mismatch when catalog declares wrong vendor for enterprise OID', () => {
    const mismatchedCatalog: SnmpTrapDefinition[] = [
      {
        oid: '1.3.6.1.4.1.2011.99.1.1', // 2011 belongs to Huawei
        name: 'bogusTrap',
        category: 'los',
        severity: 'critical',
        vendor: 'ZTE', // Mismatch!
        description: 'Wrong vendor claim',
      },
    ];

    const report = detectOidConflicts([], mismatchedCatalog);
    expect(report.valid).toBe(false);
    const issue = report.conflicts.find((c) => c.category === 'pen_mismatch');
    expect(issue).toBeDefined();
    expect(issue?.type).toBe('error');
  });

  it('detects cross-vendor collision when a vendor claims another vendor enterprise PEN', () => {
    const fakePackages: VendorPackageContent[] = [
      {
        vendorId: 'zte',
        sources: [
          {
            source_id: 'src-zte-rogue',
            vendor: 'zte',
            document_title: 'ZTE Manual',
            source_type: 'manual',
            target_models: ['C300'],
            firmware_versions: ['V2.1'],
            confidence_grade: 'A',
            license_status: 'permissive',
            provenance: 'https://zte.example.com',
            extracted_date: '2026-09-10',
            facts: [
              {
                oid: '1.3.6.1.4.1.2011.6.128.1.1', // Claiming Huawei PEN 2011!
                name: 'hwClaimedByZte',
                syntax: 'Integer32',
                access: 'read-only',
                status: 'current',
                description: 'Collision fact',
              },
            ],
          },
        ],
        compatibility: {
          vendor: 'ZTE',
          priority: 'P0',
          families: [],
        },
      },
    ];

    const report = detectOidConflicts(fakePackages, []);
    expect(report.valid).toBe(false);
    const issue = report.conflicts.find((c) => c.category === 'cross_vendor_collision');
    expect(issue).toBeDefined();
    expect(issue?.type).toBe('error');
  });

  it('detects duplicate non-standard OID declared across multiple packages', () => {
    const packages: VendorPackageContent[] = [
      {
        vendorId: 'vendor-a',
        sources: [
          {
            source_id: 'src-a',
            vendor: 'vendor-a',
            document_title: 'Doc A',
            source_type: 'manual',
            target_models: ['M1'],
            firmware_versions: ['V1'],
            confidence_grade: 'A',
            license_status: 'permissive',
            provenance: 'https://a.example.com',
            extracted_date: '2026-09-10',
            facts: [
              {
                oid: '1.3.6.1.4.1.99999.1.2.3',
                name: 'customTrap',
                syntax: 'Integer32',
                access: 'read-only',
                status: 'current',
                description: 'Fact in vendor A',
              },
            ],
          },
        ],
        compatibility: { vendor: 'A', priority: 'P2', families: [] },
      },
      {
        vendorId: 'vendor-b',
        sources: [
          {
            source_id: 'src-b',
            vendor: 'vendor-b',
            document_title: 'Doc B',
            source_type: 'manual',
            target_models: ['M2'],
            firmware_versions: ['V2'],
            confidence_grade: 'A',
            license_status: 'permissive',
            provenance: 'https://b.example.com',
            extracted_date: '2026-09-10',
            facts: [
              {
                oid: '1.3.6.1.4.1.99999.1.2.3', // Duplicate claim!
                name: 'customTrap',
                syntax: 'Integer32',
                access: 'read-only',
                status: 'current',
                description: 'Fact in vendor B',
              },
            ],
          },
        ],
        compatibility: { vendor: 'B', priority: 'P2', families: [] },
      },
    ];

    const report = detectOidConflicts(packages, []);
    expect(report.valid).toBe(false);
    const collision = report.conflicts.find((c) => c.category === 'cross_vendor_collision');
    expect(collision).toBeDefined();
    expect(collision?.sourceVendors).toContain('vendor-a');
    expect(collision?.sourceVendors).toContain('vendor-b');
  });
});
