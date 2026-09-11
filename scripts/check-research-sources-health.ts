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

async function checkUrlLive(
  urlStr: string,
  timeoutMs: number,
): Promise<{ status: 'OK' | 'REDIRECT' | 'BROKEN' | 'INVALID_SYNTAX'; statusCode?: number; message?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { status: 'INVALID_SYNTAX', message: 'Invalid URL syntax' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { status: 'INVALID_SYNTAX', message: `Unsupported protocol: ${parsed.protocol}` };
  }

  const defaultHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 (FTTH-Copilot Link Auditor)',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Cookie: 'adtran#lang=en',
  };

  try {
    let res: Response;
    try {
      res = await fetch(parsed, {
        method: 'HEAD',
        headers: defaultHeaders,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });
    } catch {
      // If HEAD throws (e.g. server drops connection on HEAD), retry with GET
      res = await fetch(parsed, {
        method: 'GET',
        headers: defaultHeaders,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });
    }

    // If server rejects HEAD with 405 (Method Not Allowed) or 501, retry with GET
    if (res.status === 405 || res.status === 501) {
      res = await fetch(parsed, {
        method: 'GET',
        headers: defaultHeaders,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });
    }

    // Some servers (e.g. Cloudflare-backed portals like Adtran) return 301 on HEAD to enforce GET / set session cookies
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc === parsed.pathname || loc === parsed.pathname + '/' || loc === parsed.href) {
        const getRes = await fetch(parsed, {
          method: 'GET',
          headers: defaultHeaders,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'manual',
        });
        if (getRes.status >= 200 && getRes.status < 300) {
          return { status: 'OK', statusCode: getRes.status };
        }
      }
    }

    const code = res.status;
    if (code >= 200 && code < 300) {
      return { status: 'OK', statusCode: code };
    } else if (code >= 300 && code < 400) {
      const location = res.headers.get('location') ?? 'unknown';
      return { status: 'REDIRECT', statusCode: code, message: `Redirects to: ${location}` };
    } else if (code === 403 || code === 401) {
      return { status: 'OK', statusCode: code, message: 'Protected by WAF/Auth but domain resolves' };
    } else {
      return { status: 'BROKEN', statusCode: code, message: `HTTP ${code}` };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'BROKEN', message };
  }
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
