import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const staged = execFileSync('git', ['-c', 'core.fsmonitor=false', 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const packages = new Map();
for (const file of staged) {
  if (!/^(apps|packages|services)\//.test(file)) continue;
  let dir = dirname(resolve(root, file));
  while (dir.startsWith(root + sep) && dir !== root) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.name && pkg.scripts?.typecheck) packages.set(pkg.name, dir);
      break;
    }
    dir = dirname(dir);
  }
}
if (!packages.size) console.log('No changed packages with typecheck.');
for (const [name, dir] of packages) {
  if (name === '@ftth-copilot/db' && !existsSync(join(dir, 'src/generated/client/index.d.ts'))) {
    console.error('Prisma client missing; run pnpm db:generate before committing.');
    process.exit(1);
  }
  if (name === '@ftth-copilot/web' && !existsSync(join(dir, '.next/types/routes.d.ts'))) {
    console.error('Next.js route types missing; run pnpm --filter @ftth-copilot/web exec next typegen before committing.');
    process.exit(1);
  }
  console.log(`Typechecking ${name}...`);
  const result = spawnSync('pnpm', ['--filter', name, 'typecheck'], { cwd: root, stdio: 'inherit' });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
