import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const expected = process.argv[2] ?? process.env['RELEASE_VERSION'];

if (!expected || !/^\d+\.\d+\.\d+$/.test(expected)) {
  console.error('Usage: pnpm check:version <semver>');
  process.exit(1);
}

const mismatches: string[] = [];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function expectEqual(relativePath: string, actual: string): void {
  if (actual !== expected) {
    mismatches.push(`${relativePath}: expected ${expected}, found ${actual}`);
  }
}

function expectMatch(relativePath: string, pattern: RegExp, label: string): void {
  const match = read(relativePath).match(pattern);
  if (!match || match[1] !== expected) {
    mismatches.push(`${relativePath}: expected ${label} ${expected}`);
  }
}

const packageFiles = [
  'package.json',
  'apps/web/package.json',
  ...fs
    .readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const packagePath = path.join('packages', entry.name, 'package.json');
      return fs.existsSync(path.join(root, packagePath)) ? [packagePath] : [];
    }),
  ...['core', 'mikrotik', 'mikrowisp', 'smartolt']
    .map((name) => path.join('packages', 'connectors', name, 'package.json'))
    .filter((packagePath) => fs.existsSync(path.join(root, packagePath))),
];

for (const packagePath of packageFiles) {
  const manifest = JSON.parse(read(packagePath)) as { version?: string };
  expectEqual(packagePath, manifest.version ?? '<missing>');
}

expectMatch('apps/web/src-tauri/tauri.conf.json', /"version"\s*:\s*"([^"]+)"/, 'Tauri version');
expectMatch('apps/web/src-tauri/Cargo.toml', /^version\s*=\s*"([^"]+)"/m, 'Cargo version');
expectMatch('apps/web/android/app/build.gradle', /versionName\s+"([^"]+)"/, 'Android versionName');
expectMatch('apps/web/app/api/health/route.ts', /npm_package_version[^\n]+\?\?\s*'([^']+)'/, 'health fallback');
expectMatch('packages/agent-core/src/telemetry/exporter.ts', /version:\s*'([^']+)'/, 'telemetry scope version');

if (mismatches.length > 0) {
  console.error(`Release version check failed for ${expected}:`);
  for (const mismatch of mismatches) console.error(`- ${mismatch}`);
  process.exit(1);
}

console.log(`Release version check passed: ${expected}`);
