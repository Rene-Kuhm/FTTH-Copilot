import { spawnSync } from 'node:child_process';

const checks = ['security:sast:eslint', 'security:sast:semgrep', 'security:audit'];

for (const check of checks) {
  const result = spawnSync('pnpm', ['run', check], { stdio: 'inherit' });
  if (result.status === 0) {
    console.log(`${check}: PASSED`);
    continue;
  }
  console.error(`${check}: FAILED (${result.error?.message ?? result.signal ?? result.status})`);
  process.exitCode = 1;
}
