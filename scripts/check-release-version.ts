import process from "node:process";
import { findVersionMismatches } from "./lib/version-carriers.ts";

const root = process.cwd();
const expected = process.argv[2] ?? process.env["RELEASE_VERSION"];

if (!expected || !/^\d+\.\d+\.\d+$/.test(expected)) {
  console.error("Usage: pnpm check:version <semver>");
  process.exit(1);
}

const mismatches = findVersionMismatches(root, expected);

if (mismatches.length > 0) {
  console.error(`Release version check failed for ${expected}:`);
  for (const mismatch of mismatches) {
    console.error(`- ${mismatch.path}: expected ${mismatch.label} ${expected}, found ${mismatch.found}`);
  }
  process.exit(1);
}

console.log(`Release version check passed: ${expected}`);
