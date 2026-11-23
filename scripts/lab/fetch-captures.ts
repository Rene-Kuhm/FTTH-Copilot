/**
 * Download the LibreNMS SNMP captures the virtual bench serves.
 *
 * The captures are GPL-3.0 and they are **not** part of this repository: every
 * run of `pnpm lab:up` (and `pnpm lab:check`, when the files are missing)
 * fetches them from the commit pinned in `lib/captures.ts` into
 * `docker/lab/captures/`, which `.gitignore` excludes. Provenance is recorded
 * in `docker/lab/README.md`.
 *
 * Usage: `tsx scripts/lab/fetch-captures.ts [--force]`
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  CAPTURES,
  CAPTURES_DIRECTORY,
  captureRelativePath,
  captureUrl,
} from './lib/captures.ts';
import { parseSysDescr } from './lib/snmprec.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CAPTURES_DIR = path.join(REPO_ROOT, CAPTURES_DIRECTORY);

interface FetchOptions {
  readonly force: boolean;
}

function parseArgs(argv: readonly string[]): FetchOptions {
  return { force: argv.includes('--force') };
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

/** Files currently in the captures directory. */
function presentFiles(): string[] {
  if (!fs.existsSync(CAPTURES_DIR)) return [];
  return fs.readdirSync(CAPTURES_DIR).filter((name) => name.endsWith('.snmprec'));
}

async function download(file: string): Promise<string> {
  const url = captureUrl(file);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`GET ${url} answered ${response.status} ${response.statusText}`);
  }
  const content = await response.text();
  if (content.trim() === '') throw new Error(`${file}: the download is empty`);
  return content;
}

/**
 * Write the capture and the .gitignore marker atomically: a truncated file
 * would be served by snmpsim as a half-empty device.
 */
function writeCapture(file: string, content: string): void {
  const destination = path.join(REPO_ROOT, captureRelativePath(file));
  const temporary = `${destination}.partial`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, destination);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });

  const present = new Set(presentFiles());
  const downloaded: string[] = [];
  const skipped: string[] = [];

  for (const entry of CAPTURES) {
    const file = entry.file;
    if (!options.force && present.has(file)) {
      skipped.push(file);
      continue;
    }
    process.stdout.write(`fetching ${file} (${entry.vendor} ${entry.model}) `);
    let content: string;
    try {
      content = await download(file);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    const sysDescr = parseSysDescr(content);
    if (sysDescr === null) {
      fail(`${file}: the capture has no usable sysDescr (${captureUrl(file)})`);
    }
    writeCapture(file, content);
    downloaded.push(file);
    console.log(`ok (sysDescr: ${sysDescr})`);
  }

  const missing = CAPTURES.filter((entry) => !downloaded.includes(entry.file) && !present.has(entry.file));
  if (missing.length > 0) {
    fail(`captures still missing: ${missing.map((entry) => entry.file).join(', ')}`);
  }

  console.log(
    `\n${downloaded.length} downloaded, ${skipped.length} already present in ${CAPTURES_DIRECTORY}/`,
  );
  console.log(
    'Source: LibreNMS tests/snmpsim at the commit pinned in scripts/lab/lib/captures.ts (GPL-3.0).',
  );
}

main().catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
