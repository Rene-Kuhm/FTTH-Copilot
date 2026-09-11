#!/usr/bin/env tsx
/**
 * OID Collision & Semantic Conflict Check CLI (Roadmap Fase 8).
 *
 * Scans all research/olt/<vendor>/ definitions and KNOWN_TRAP_DEFINITIONS to detect:
 * 1. Cross-vendor enterprise OID collisions.
 * 2. Enterprise PEN mismatches against IANA registry.
 * 3. Semantic contradictions (category/severity conflicts).
 * 4. Duplicate catalog entries.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  detectOidConflicts,
  KNOWN_TRAP_DEFINITIONS,
  type VendorPackageContent,
  type SourceRecord,
  type VendorCompatibilityRecord,
} from '../packages/monitoring/src';

const RESEARCH_ROOT = path.resolve(__dirname, '../research/olt');

function loadVendorPackages(): VendorPackageContent[] {
  const packages: VendorPackageContent[] = [];
  if (!fs.existsSync(RESEARCH_ROOT)) return packages;

  const vendorDirs = fs.readdirSync(RESEARCH_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const vendorId of vendorDirs) {
    const sourcesPath = path.join(RESEARCH_ROOT, vendorId, 'sources.yaml');
    const compatPath = path.join(RESEARCH_ROOT, vendorId, 'compatibility.yaml');
    if (!fs.existsSync(sourcesPath) || !fs.existsSync(compatPath)) continue;

    try {
      const sources = YAML.parse(fs.readFileSync(sourcesPath, 'utf8')) as SourceRecord[];
      const compatibility = YAML.parse(fs.readFileSync(compatPath, 'utf8')) as VendorCompatibilityRecord;
      packages.push({ vendorId, sources, compatibility });
    } catch {
      // Ignore parse errors here; handled by check:sources
    }
  }

  return packages;
}

function main(): void {
  const packages = loadVendorPackages();
  console.log(`\n🔎 Scanning OIDs across ${packages.length} vendor packages and ${KNOWN_TRAP_DEFINITIONS.length} catalog definitions...\n`);

  const report = detectOidConflicts(packages, KNOWN_TRAP_DEFINITIONS);

  const errors = report.conflicts.filter((c) => c.type === 'error');
  const warnings = report.conflicts.filter((c) => c.type === 'warning');

  if (warnings.length > 0) {
    console.warn(`⚠️ Found ${warnings.length} OID warning(s):`);
    for (const w of warnings) {
      console.warn(`   [${w.category}] OID: ${w.oid} -> ${w.message}`);
    }
  }

  if (errors.length > 0) {
    console.error(`\n❌ Detected ${errors.length} OID Collision / Semantic Conflict(s):`);
    for (const e of errors) {
      console.error(`   - [${e.category}] OID: ${e.oid} -> ${e.message}`);
    }
    console.error(`\nTotal OIDs analyzed: ${report.totalOidsChecked}. Check FAILED.`);
    process.exit(1);
  }

  console.log(`✅ OID Analysis Clean: ${report.totalOidsChecked} unique OIDs checked across all vendors. Zero collisions or semantic conflicts detected!\n`);
}

main();
