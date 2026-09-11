#!/usr/bin/env tsx
/**
 * SNMP Capture & Evidence Sanitizer CLI (Roadmap Fase 8).
 *
 * Usage:
 *   pnpm sanitize:snmp --input raw.log --output clean.log
 *   cat raw.json | pnpm sanitize:snmp > clean.json
 *   pnpm sanitize:snmp --input raw.log --community mySecret123
 */

import fs from 'node:fs';
import { sanitizeSnmpCapture, type SnmpSanitizerOptions } from '../packages/monitoring/src';

function parseArgs(): {
  inputFile?: string;
  outputFile?: string;
  options: SnmpSanitizerOptions;
} {
  const args = process.argv.slice(2);
  let inputFile: string | undefined;
  let outputFile: string | undefined;
  const customCommunities: string[] = [];
  let ipReplacementMode: 'doc-ip' | 'token' = 'doc-ip';
  let preserveVendorSerialPrefix = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' || arg === '-i') {
      inputFile = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      outputFile = args[++i];
    } else if (arg === '--community' || arg === '-c') {
      const comm = args[++i];
      if (comm) customCommunities.push(comm);
    } else if (arg === '--token-ip') {
      ipReplacementMode = 'token';
    } else if (arg === '--mask-all-serials') {
      preserveVendorSerialPrefix = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return {
    inputFile,
    outputFile,
    options: {
      customCommunities,
      ipReplacementMode,
      preserveVendorSerialPrefix,
    },
  };
}

function printHelp(): void {
  console.log(`
SNMP Capture & Evidence Sanitizer (Roadmap Fase 8)

Options:
  --input, -i <file>        Input log, walk, or JSON capture file (defaults to stdin)
  --output, -o <file>       Output file (defaults to stdout)
  --community, -c <string>  Additional community string to redact (can specify multiple)
  --token-ip                Replace IPs with <REDACTED_IP> instead of RFC 5737 doc IPs
  --mask-all-serials        Mask complete serial including 4-character vendor prefix
  --help, -h                Show this help message
`);
}

function readInput(inputFile?: string): string {
  if (inputFile && inputFile !== '-') {
    if (!fs.existsSync(inputFile)) {
      console.error(`Error: input file not found: ${inputFile}`);
      process.exit(1);
    }
    return fs.readFileSync(inputFile, 'utf8');
  }
  return fs.readFileSync(0, 'utf8');
}

function writeOutput(content: string, outputFile?: string): void {
  if (outputFile && outputFile !== '-') {
    fs.writeFileSync(outputFile, content, 'utf8');
    console.error(`Sanitized content written to ${outputFile}`);
  } else {
    process.stdout.write(content);
  }
}

function main(): void {
  const { inputFile, outputFile, options } = parseArgs();
  const raw = readInput(inputFile);
  const sanitized = sanitizeSnmpCapture(raw, options);
  writeOutput(sanitized, outputFile);
}

main();
