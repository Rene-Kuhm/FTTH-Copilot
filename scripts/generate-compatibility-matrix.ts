/**
 * OLT Multi-Vendor Compatibility Matrix Generator & Validator (Roadmap Fase 1).
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
  type VendorPackageContent,
  type SourceRecord,
  type VendorCompatibilityRecord,
} from '../packages/monitoring/src';

const RESEARCH_ROOT = path.resolve(__dirname, '../research/olt');

interface MatrixRow {
  priority: 'P0' | 'P1' | 'P2';
  vendor: string;
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

  return { packages, errors };
}

function generateMarkdownTable(packages: VendorPackageContent[]): string {
  const rows: MatrixRow[] = [];

  for (const pkg of packages) {
    for (const fam of pkg.compatibility.families) {
      rows.push({
        priority: pkg.compatibility.priority,
        vendor: pkg.compatibility.vendor,
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

  const lines: string[] = [];
  lines.push('| Prioridad | Fabricante | Familia | Firmware | Nivel | Grado | Fuentes |');
  lines.push('|---|---|---|---|---|---|---|');

  for (const r of rows) {
    lines.push(
      `| ${r.priority} | ${r.vendor} | ${r.family} | ${r.firmware} | ${r.level} | ${r.grade} | ${r.sourceCount} |`
    );
  }

  return lines.join('\n');
}

function main(): void {
  const isCheckMode = process.argv.includes('--check');
  const { packages, errors } = loadVendorPackages();

  if (errors.length > 0) {
    console.error(`\n❌ OLT Research Validation Failed with ${errors.length} error(s):`);
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  console.log(`\n✅ OLT Research Registry Validated: ${packages.length} vendor packages loaded without errors.`);
  const table = generateMarkdownTable(packages);

  if (isCheckMode) {
    console.log(`Checked ${packages.length} vendors cleanly.`);
    return;
  }

  console.log('\n--- Generated Compatibility Matrix ---\n');
  console.log(table);
  console.log('\n--------------------------------------\n');
}

main();
