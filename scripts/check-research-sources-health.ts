#!/usr/bin/env tsx
/**
 * Research Sources Health & Link Integrity Checker (Roadmap Fase 8).
 *
 * Scans all research/olt/<vendor>/sources.yaml, tests external link reachability,
 * and reports broken links, domain deprecations, or outdated references.
 *
 * Usage:
 *   pnpm check:sources:health
 *   pnpm check:sources:health --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import YAML from 'yaml';
import type { SourceRecord } from '../packages/monitoring/src';

const RESEARCH_ROOT = path.resolve(__dirname, '../research/olt');

interface UrlCheckResult {
  vendorId: string;
  sourceId: string;
  url: string;
  status: 'OK' | 'REDIRECT' | 'BROKEN' | 'SKIPPED' | 'INVALID_SYNTAX';
  statusCode?: number;
  message?: string;
}

function parseArgs(): { dryRun: boolean; timeoutMs: number } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || process.env.OFFLINE_MODE === 'true';
  const timeoutArg = args.find((a) => a.startsWith('--timeout='));
  const timeoutMs = timeoutArg ? parseInt(timeoutArg.split('=')[1]!, 10) : 6000;
  return { dryRun, timeoutMs };
}

function extractSourceUrls(): Array<{ vendorId: string; sourceId: string; url: string }> {
  const list: Array<{ vendorId: string; sourceId: string; url: string }> = [];
  if (!fs.existsSync(RESEARCH_ROOT)) return list;

  const vendorDirs = fs.readdirSync(RESEARCH_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const vendorId of vendorDirs) {
    const sourcesPath = path.join(RESEARCH_ROOT, vendorId, 'sources.yaml');
    if (!fs.existsSync(sourcesPath)) continue;

    try {
      const parsed = YAML.parse(fs.readFileSync(sourcesPath, 'utf8')) as SourceRecord[];
      if (Array.isArray(parsed)) {
        for (const src of parsed) {
          const rawUrl = src.url ?? (src as unknown as { provenance?: string }).provenance;
          if (rawUrl) {
            list.push({
              vendorId,
              sourceId: src.source_id,
              url: rawUrl.trim(),
            });
          }
        }
      }
    } catch {
      // Handled by sources validator
    }
  }

  return list;
}

function checkUrlLive(
  urlStr: string,
  timeoutMs: number,
): Promise<{ status: 'OK' | 'REDIRECT' | 'BROKEN' | 'INVALID_SYNTAX'; statusCode?: number; message?: string }> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return resolve({ status: 'INVALID_SYNTAX', message: 'Invalid URL syntax' });
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return resolve({ status: 'INVALID_SYNTAX', message: `Unsupported protocol: ${parsed.protocol}` });
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (FTTH-Copilot Link Auditor; +https://github.com/Rene-Kuhm/FTTH-Copilot)',
          Accept: '*/*',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 200 && code < 300) {
          resolve({ status: 'OK', statusCode: code });
        } else if (code >= 300 && code < 400) {
          resolve({ status: 'REDIRECT', statusCode: code, message: `Redirects to: ${res.headers.location ?? 'unknown'}` });
        } else if (code === 403 || code === 401) {
          // Some sites block automated HEAD requests (e.g. cloudflare/waf) but URL exists
          resolve({ status: 'OK', statusCode: code, message: 'Protected by WAF/Auth but domain resolves' });
        } else {
          resolve({ status: 'BROKEN', statusCode: code, message: `HTTP ${code}` });
        }
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 'BROKEN', message: `Request timed out after ${timeoutMs}ms` });
    });

    req.on('error', (err) => {
      resolve({ status: 'BROKEN', message: err.message });
    });

    req.end();
  });
}

async function main(): Promise<void> {
  const { dryRun, timeoutMs } = parseArgs();
  const sources = extractSourceUrls();

  console.log(`\n🔗 Auditing ${sources.length} research source link(s) across vendor packages...`);
  if (dryRun) {
    console.log(`ℹ️ Dry-run mode enabled: checking syntax and formatting only without network calls.`);
  }

  const results: UrlCheckResult[] = [];

  for (const item of sources) {
    if (dryRun) {
      let isSyntaxValid = false;
      try {
        const u = new URL(item.url);
        isSyntaxValid = u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        isSyntaxValid = false;
      }

      results.push({
        ...item,
        status: isSyntaxValid ? 'OK' : 'INVALID_SYNTAX',
        message: isSyntaxValid ? 'Syntax valid (dry-run)' : 'Malformed URL',
      });
      continue;
    }

    const check = await checkUrlLive(item.url, timeoutMs);
    results.push({
      ...item,
      ...check,
    });
  }

  let brokenCount = 0;
  let redirectCount = 0;
  let okCount = 0;

  for (const r of results) {
    if (r.status === 'OK') {
      okCount++;
    } else if (r.status === 'REDIRECT') {
      redirectCount++;
      console.warn(`⚠️ [${r.vendorId}] Redirect (${r.statusCode}): ${r.url} -> ${r.message}`);
    } else {
      brokenCount++;
      console.error(`❌ [${r.vendorId}] Broken link (${r.sourceId}): ${r.url} -> ${r.message}`);
    }
  }

  console.log('\n--- Link Integrity Audit Summary ---');
  console.log(`Total URLs: ${results.length}`);
  console.log(`✅ OK: ${okCount}`);
  console.log(`⚠️ Redirects: ${redirectCount}`);
  console.log(`❌ Broken / Invalid: ${brokenCount}`);

  if (brokenCount > 0 && !dryRun) {
    console.error(`\nAudit failed with ${brokenCount} unreachable link(s). Please review research/olt/ sources.\n`);
    process.exit(1);
  }

  console.log('\n🎉 Source link audit passed cleanly!\n');
}

main().catch((err) => {
  console.error('Audit fatal error:', err);
  process.exit(1);
});
