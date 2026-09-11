/**
 * OLT Multi-Vendor Compatibility Matrix Generator & Validator (Roadmap Fase 1 & 8).
 *
 * Scans research/olt/<vendor>/, validates sources and compatibility records,
 * and generates the canonical Markdown compatibility table directly from data.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  validateSourcesList,
  validateCompatibilityRecord,
  validateCrossVendorRegistry,
  validateCatalogFactsTraceability,
  KNOWN_TRAP_DEFINITIONS,
  type VendorPackageContent,
  type SourceRecord,
  type VendorCompatibilityRecord,
} from '../packages/monitoring/src';

const RESEARCH_ROOT = path.resolve(__dirname, '../research/olt');
const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, '../docs/compatibility-matrix.md');

interface MatrixRow {
  priority: 'P0' | 'P1' | 'P2';
  vendor: string;
  vendorId: string;
  family: string;
  firmware: string;
  level: string;
  grade: string;
  sourceCount: number;
}

function loadVendorPackages(): { packages: VendorPackageContent[]; errors: string[] } {
  const packages: VendorPackageContent[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(RESEARCH_ROOT)) {
    errors.push(`Directory does not exist: ${RESEARCH_ROOT}`);
    return { packages, errors };
  }

  const vendorDirs = fs.readdirSync(RESEARCH_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const vendorId of vendorDirs) {
    const vendorDir = path.join(RESEARCH_ROOT, vendorId);
    const sourcesPath = path.join(vendorDir, 'sources.yaml');
    const compatPath = path.join(vendorDir, 'compatibility.yaml');

    if (!fs.existsSync(sourcesPath)) {
      errors.push(`Missing sources.yaml in ${vendorDir}`);
      continue;
    }
    if (!fs.existsSync(compatPath)) {
      errors.push(`Missing compatibility.yaml in ${vendorDir}`);
      continue;
    }

    let parsedSources: unknown;
    let parsedCompat: unknown;

    try {
      parsedSources = YAML.parse(fs.readFileSync(sourcesPath, 'utf8'));
    } catch (err: unknown) {
      errors.push(`Failed parsing YAML in ${sourcesPath}: ${String(err)}`);
      continue;
    }

    try {
      parsedCompat = YAML.parse(fs.readFileSync(compatPath, 'utf8'));
    } catch (err: unknown) {
      errors.push(`Failed parsing YAML in ${compatPath}: ${String(err)}`);
      continue;
    }

    const sValidation = validateSourcesList(parsedSources, sourcesPath);
    if (!sValidation.valid) {
      for (const iss of sValidation.issues) {
        errors.push(`[${vendorId}/sources] ${iss.message}`);
      }
    }

    const cValidation = validateCompatibilityRecord(parsedCompat, compatPath);
    if (!cValidation.valid) {
      for (const iss of cValidation.issues) {
        errors.push(`[${vendorId}/compatibility] ${iss.message}`);
      }
    }

    if (sValidation.valid && cValidation.valid) {
      packages.push({
        vendorId,
        sources: parsedSources as SourceRecord[],
        compatibility: parsedCompat as VendorCompatibilityRecord,
      });
    }
  }

  const crossResult = validateCrossVendorRegistry(packages);
  if (!crossResult.valid) {
    for (const iss of crossResult.issues) {
      errors.push(`[cross-vendor] ${iss.message}`);
    }
  }

  const catalogResult = validateCatalogFactsTraceability(packages, KNOWN_TRAP_DEFINITIONS);
  if (!catalogResult.valid) {
    for (const iss of catalogResult.issues) {
      errors.push(`[catalog-traceability] ${iss.message}`);
    }
  }

  return { packages, errors };
}

function generateCompleteDocument(packages: VendorPackageContent[]): string {
  const rows: MatrixRow[] = [];
  let totalFacts = 0;
  let totalSources = 0;

  for (const pkg of packages) {
    totalSources += pkg.sources.length;
    for (const src of pkg.sources) {
      totalFacts += src.facts.length;
    }
    for (const fam of pkg.compatibility.families) {
      rows.push({
        priority: pkg.compatibility.priority,
        vendor: pkg.compatibility.vendor,
        vendorId: pkg.vendorId,
        family: fam.family,
        firmware: fam.firmware,
        level: fam.level,
        grade: fam.confidence_grade,
        sourceCount: fam.sources.length,
      });
    }
  }

  // Sort by priority (P0, P1, P2), then vendor, then family
  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  rows.sort((a, b) => {
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    if (a.vendor !== b.vendor) {
      return a.vendor.localeCompare(b.vendor);
    }
    return a.family.localeCompare(b.family);
  });

  const levelCounts: Record<string, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  for (const r of rows) {
    levelCounts[r.level] = (levelCounts[r.level] ?? 0) + 1;
  }

  const doc: string[] = [];
  doc.push('# Multi-Vendor OLT Compatibility Matrix');
  doc.push('');
  doc.push('Auto-generated from authoritative vendor sources in `research/olt/`.');
  doc.push('');
  doc.push('## 1. Summary Statistics');
  doc.push('');
  doc.push(`- **Total Vendors Registered**: ${packages.length}`);
  doc.push(`- **Total Hardware Families**: ${rows.length}`);
  doc.push(`- **Documented Sources**: ${totalSources}`);
  doc.push(`- **Verified OID Facts**: ${totalFacts}`);
  doc.push('');
  doc.push('| Support Level | Hardware Families | Status |');
  doc.push('|---|---|---|');
  doc.push(`| **Level L1 (Documented)** | ${levelCounts.L1 ?? 0} | Research cataloged, MIBs registered, architectural limits documented |`);
  doc.push(`| **Level L2 (Simulated)** | ${levelCounts.L2 ?? 0} | Full adapter implemented, synthetic & loopback UDP tests passing |`);
  doc.push(`| **Level L3 (Lab Certified)** | ${levelCounts.L3 ?? 0} | Physical lab hardware validated with real alarms (Fase 9) |`);
  doc.push(`| **Level L4 (Field Certified)** | ${levelCounts.L4 ?? 0} | Live production certified with zero false-positives (Fase 9) |`);
  doc.push('');
  doc.push('## 2. Canonical Compatibility Table');
  doc.push('');
  doc.push('| Priority | Vendor | Family / Series | Firmware | Level | Grade | Sources |');
  doc.push('|---|---|---|---|---|---|---|');

  for (const r of rows) {
    doc.push(
      `| ${r.priority} | [${r.vendor}](../research/olt/${r.vendorId}/) | ${r.family} | ${r.firmware} | **${r.level}** | ${r.grade} | ${r.sourceCount} |`
    );
  }

  doc.push('');
  doc.push('## 3. Support Level Definitions');
  doc.push('');
  doc.push('- **Level L1 (Documented)**: Sources and MIB definitions are cataloged in `research/olt/<vendor>/sources.yaml` with valid IANA PEN and confidence grade (A/B/C). Limitations (e.g. UISP RPC vs SNMP, white-label OEM) are published.');
  doc.push('- **Level L2 (Simulated)**: A dedicated `OltVendorAdapter` normalizes traps into canonical `TelemetryEvent`s with 100% test coverage over UDP loopback sockets and golden snapshots. Conformance suite passes without physical equipment.');
  doc.push('- **Level L3 (Lab Certified)**: Certified against real physical hardware in an isolated staging test bench with controlled alarm/clear cycles.');
  doc.push('- **Level L4 (Field Certified)**: Certified on live production ISP networks across multiple firmware builds in observation shadow mode.');
  doc.push('');

  return doc.join('\n');
}

function main(): void {
  const isCheckMode = process.argv.includes('--check');
  const isWriteMode = process.argv.includes('--write');
  const outIndex = process.argv.indexOf('--output');
  const outputPath = outIndex !== -1 && process.argv[outIndex + 1] ? process.argv[outIndex + 1]! : DEFAULT_OUTPUT_PATH;

  const { packages, errors } = loadVendorPackages();

  if (errors.length > 0) {
    console.error(`\n❌ OLT Research Validation Failed with ${errors.length} error(s):`);
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  console.log(`\n✅ OLT Research Registry Validated: ${packages.length} vendor packages loaded without errors.`);

  const documentContent = generateCompleteDocument(packages);

  if (isCheckMode) {
    if (!fs.existsSync(outputPath)) {
      console.error(`\n❌ Compatibility matrix file not found: ${outputPath}`);
      process.exit(1);
    }
    const currentOnDisk = fs.readFileSync(outputPath, 'utf8');
    if (currentOnDisk !== documentContent) {
      console.error(
        `\n❌ Drift detected in compatibility matrix (${outputPath}).\n` +
          `   The matrix document does not match current research/olt definitions.\n` +
          `   Run 'pnpm generate:matrix:write' to regenerate it.`
      );
      process.exit(1);
    }
    console.log(`Checked ${packages.length} vendors cleanly and verified no drift in ${outputPath}.`);
    return;
  }

  if (isWriteMode) {
    fs.writeFileSync(outputPath, documentContent, 'utf8');
    console.log(`\n📄 Compatibility matrix published to: ${outputPath}\n`);
    return;
  }

  console.log('\n--- Generated Compatibility Matrix ---\n');
  console.log(documentContent);
  console.log('\n--------------------------------------\n');
}

main();
