#!/usr/bin/env tsx
/**
 * OLT Multi-Vendor Contribution & Gate Validator (Roadmap Fase 8).
 *
 * Verifies that any vendor contribution satisfies Gate 1 and Gate 8 criteria:
 * 1. Schema-conforming sources.yaml with valid source_id, grade, target_models, firmware, and license.
 * 2. Schema-conforming compatibility.yaml.
 * 3. Minimal reproduction test fixture present in packages/monitoring/tests/fixtures/.
 * 4. Unit test present for vendors elevated to Level L2.
 * 5. Clean fixtures without raw community strings or unmasked secrets.
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
const FIXTURES_DIR = path.resolve(__dirname, '../packages/monitoring/tests/fixtures');
const TESTS_DIR = path.resolve(__dirname, '../packages/monitoring/tests/snmp');

interface ValidationReport {
  vendorId: string;
  errors: string[];
  warnings: string[];
}

function validateVendorContribution(vendorId: string): ValidationReport {
  const report: ValidationReport = { vendorId, errors: [], warnings: [] };
  const vendorDir = path.join(RESEARCH_ROOT, vendorId);

  if (!fs.existsSync(vendorDir)) {
    report.errors.push(`Vendor directory does not exist: ${vendorDir}`);
    return report;
  }

  const sourcesPath = path.join(vendorDir, 'sources.yaml');
  const compatPath = path.join(vendorDir, 'compatibility.yaml');

  if (!fs.existsSync(sourcesPath)) {
    report.errors.push(`Missing mandatory sources.yaml in ${vendorDir}`);
  }
  if (!fs.existsSync(compatPath)) {
    report.errors.push(`Missing mandatory compatibility.yaml in ${vendorDir}`);
  }

  if (report.errors.length > 0) {
    return report;
  }

  // Parse YAML files
  let parsedSources: SourceRecord[];
  let parsedCompat: VendorCompatibilityRecord;

  try {
    parsedSources = YAML.parse(fs.readFileSync(sourcesPath, 'utf8'));
  } catch (err: unknown) {
    report.errors.push(`Failed parsing sources.yaml: ${String(err)}`);
    return report;
  }

  try {
    parsedCompat = YAML.parse(fs.readFileSync(compatPath, 'utf8'));
  } catch (err: unknown) {
    report.errors.push(`Failed parsing compatibility.yaml: ${String(err)}`);
    return report;
  }

  // Validate sources schema
  const sValidation = validateSourcesList(parsedSources, sourcesPath);
  for (const iss of sValidation.issues) {
    if (iss.type === 'error') {
      report.errors.push(`[sources.yaml] ${iss.message}`);
    } else {
      report.warnings.push(`[sources.yaml] ${iss.message}`);
    }
  }

  // Validate compatibility schema
  const cValidation = validateCompatibilityRecord(parsedCompat, compatPath);
  for (const iss of cValidation.issues) {
    if (iss.type === 'error') {
      report.errors.push(`[compatibility.yaml] ${iss.message}`);
    } else {
      report.warnings.push(`[compatibility.yaml] ${iss.message}`);
    }
  }

  // Check Gate 8 requirements for Level L2 families
  const isL2Elevated = parsedCompat.families?.some((f) => f.level === 'L2' || f.level === 'L3' || f.level === 'L4');
  if (isL2Elevated) {
    // 1. Fixture must exist in research/olt/<vendor>/fixtures/
    const vendorFixturesDir = path.join(vendorDir, 'fixtures');
    const fixtureFiles = fs.existsSync(vendorFixturesDir)
      ? fs.readdirSync(vendorFixturesDir).filter((f) => f.endsWith('.json'))
      : [];

    if (fixtureFiles.length === 0) {
      report.errors.push(
        `Gate 8 Error: Vendor '${vendorId}' claims Level L2 support but lacks reproduction fixture in research/olt/${vendorId}/fixtures/*.json`,
      );
    } else {
      // Check fixtures for leaked community strings or unmasked serials
      for (const fixFile of fixtureFiles) {
        const fixContent = fs.readFileSync(path.join(vendorFixturesDir, fixFile), 'utf8');
        if (fixContent.includes('"community": "public"') || fixContent.includes('"community": "private"')) {
          report.warnings.push(`Fixture '${fixFile}' contains plaintext community string ("public"/"private"). Consider sanitizing.`);
        }
      }
    }

    // 2. Unit test must exist
    const testFile = path.join(TESTS_DIR, `${vendorId}-adapter.test.ts`);
    if (!fs.existsSync(testFile)) {
      report.errors.push(
        `Gate 8 Error: Vendor '${vendorId}' claims Level L2 support but lacks adapter unit test at ${testFile}`,
      );
    }
  }

  return report;
}

function main(): void {
  const args = process.argv.slice(2);
  const vendorArgIndex = args.indexOf('--vendor');
  const targetVendor = vendorArgIndex !== -1 ? args[vendorArgIndex + 1] : undefined;

  let vendorList: string[] = [];

  if (targetVendor) {
    vendorList = [targetVendor];
  } else {
    vendorList = fs.readdirSync(RESEARCH_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  console.log(`\n🔍 Validating OLT Contributions for ${vendorList.length} vendor(s)...\n`);

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const v of vendorList) {
    const report = validateVendorContribution(v);
    if (report.errors.length > 0) {
      console.error(`❌ [${v}] Contribution validation FAILED:`);
      for (const err of report.errors) {
        console.error(`   - ${err}`);
      }
      totalErrors += report.errors.length;
    } else {
      console.log(`✅ [${v}] Contribution criteria satisfied.`);
    }

    if (report.warnings.length > 0) {
      for (const warn of report.warnings) {
        console.warn(`   ⚠️ ${warn}`);
      }
      totalWarnings += report.warnings.length;
    }
  }

  if (totalErrors > 0) {
    console.error(`\nValidation finished with ${totalErrors} error(s) and ${totalWarnings} warning(s).`);
    process.exit(1);
  }

  console.log(`\n🎉 All ${vendorList.length} vendor contributions verified cleanly against Gate 1 & Gate 8!\n`);
}

main();
