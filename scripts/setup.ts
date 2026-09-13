#!/usr/bin/env tsx
/**
 * Cross-platform bootstrap script for FTTH-Copilot (`pnpm setup`).
 *
 * Ensures:
 * 1. .env exists (copies .env.example and populates secure keys if missing).
 * 2. PostgreSQL is running (starts container via docker compose or connects to native).
 * 3. Prisma migrations are applied (`db:deploy`).
 * 4. Prisma client is generated (`db:generate`).
 * 5. Database is seeded (`db:seed`).
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function checkTcpPort(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function parseDbHostPort(urlStr: string | undefined): { host: string; port: number } {
  if (!urlStr) return { host: '127.0.0.1', port: 5432 };
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname === 'localhost' ? '127.0.0.1' : (parsed.hostname || '127.0.0.1');
    return {
      host,
      port: parsed.port ? parseInt(parsed.port, 10) : 5432,
    };
  } catch {
    return { host: '127.0.0.1', port: 5432 };
  }
}

function getDockerComposeCommand(): string | null {
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    return 'docker compose';
  } catch {
    try {
      execSync('docker-compose version', { stdio: 'ignore' });
      return 'docker-compose';
    } catch {
      return null;
    }
  }
}

async function main(): Promise<void> {
  console.log('🚀 Setting up FTTH-Copilot development environment...\n');

  // 1. Check or initialize .env
  const envPath = path.join(ROOT_DIR, '.env');
  const envExamplePath = path.join(ROOT_DIR, '.env.example');

  if (!fs.existsSync(envPath)) {
    if (!fs.existsSync(envExamplePath)) {
      console.error('❌ Neither .env nor .env.example found in repository root.');
      process.exit(1);
    }
    console.log('📄 Creating .env from .env.example...');
    fs.copyFileSync(envExamplePath, envPath);
  }

  let envContent = fs.readFileSync(envPath, 'utf8');
  let envUpdated = false;

  // Contract anchor strings from .env.example template:
  // If .env.example changes these placeholders, update them here accordingly.
  const JWT_SECRET_PLACEHOLDER = 'replace-with-a-random-32-byte-secret';
  const KMS_MASTER_KEY_PLACEHOLDER = 'replace-with-a-different-random-32-byte-secret';

  if (envContent.includes(JWT_SECRET_PLACEHOLDER)) {
    const secret = crypto.randomBytes(32).toString('hex');
    envContent = envContent.replace(JWT_SECRET_PLACEHOLDER, secret);
    envUpdated = true;
    console.log('🔑 Generated secure JWT_SECRET in .env');
  }

  if (envContent.includes(KMS_MASTER_KEY_PLACEHOLDER)) {
    const secret = crypto.randomBytes(32).toString('hex');
    envContent = envContent.replace(KMS_MASTER_KEY_PLACEHOLDER, secret);
    envUpdated = true;
    console.log('🔑 Generated secure KMS_MASTER_KEY in .env');
  }

  if (envUpdated) {
    fs.writeFileSync(envPath, envContent, 'utf8');
  }

  // Load environment
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }

  // Check LLM configuration
  const llmProvider = process.env.LLM_PROVIDER?.trim();
  const minimaxKey = process.env.MINIMAX_API_KEY?.trim();
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  const qwenKey = process.env.QWEN_API_KEY?.trim();

  const isInvalidKey = (k: string | undefined) =>
    !k || k === '' || k.includes('your-key-here') || k.includes('replace-with');

  let llmStatusMessage = 'None configured (chat agent disabled)';
  if (llmProvider) {
    let keyValid = false;
    if (llmProvider === 'minimax' && !isInvalidKey(minimaxKey)) keyValid = true;
    if (llmProvider === 'deepseek' && !isInvalidKey(deepseekKey)) keyValid = true;
    if (llmProvider === 'qwen' && !isInvalidKey(qwenKey)) keyValid = true;

    if (!keyValid) {
      console.log(`\n⚠️  Warning: LLM_PROVIDER='${llmProvider}' is set, but no valid API key was found.`);
      console.log(`   Update ${llmProvider.toUpperCase()}_API_KEY in .env to enable the chat assistant.`);
      llmStatusMessage = `${llmProvider} (API key missing or placeholder)`;
    } else {
      console.log(`\n🤖 LLM Provider configured: ${llmProvider}`);
      llmStatusMessage = `${llmProvider} (active)`;
    }
  } else {
    console.log('\nℹ️  Notice: No LLM_PROVIDER configured in .env. AI chat assistant will be inactive until you set one.');
  }

  // 2. Check PostgreSQL availability
  const { host, port } = parseDbHostPort(process.env.DATABASE_URL);
  console.log(`\n🔍 Checking PostgreSQL at ${host}:${port}...`);

  let isReachable = await checkTcpPort(host, port);
  const composeCmd = getDockerComposeCommand();

  if (!isReachable) {
    if (composeCmd) {
      console.log(`📦 Docker Compose detected. Starting PostgreSQL container with '${composeCmd} up -d postgres'...`);
      execSync(`${composeCmd} up -d postgres`, { cwd: ROOT_DIR, stdio: 'inherit' });

      console.log('⏳ Waiting for PostgreSQL container to accept connections...');
      const maxAttempts = 30;
      for (let i = 1; i <= maxAttempts; i++) {
        await sleep(1000);
        isReachable = await checkTcpPort(host, port);
        if (isReachable) break;
        if (i % 5 === 0) console.log(`   Waiting... (${i}/${maxAttempts}s)`);
      }
    }
  }

  if (!isReachable) {
    console.error(`\n❌ Could not connect to PostgreSQL at ${host}:${port}.`);
    console.error('Please make sure PostgreSQL is running, or install Docker/Docker Compose so it can be started automatically.');
    process.exit(1);
  }

  console.log(`✓ PostgreSQL is up and accepting connections at ${host}:${port}.`);

  // 3. Apply Prisma migrations
  console.log('\n📦 Applying database migrations...');
  try {
    execSync('pnpm --filter @ftth-copilot/db db:deploy', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: process.env,
    });
  } catch {
    console.error('\n❌ Database migration failed.');
    console.error('\n💡 Troubleshooting:');
    console.error('If you are using a native PostgreSQL installation (not Docker Compose):');
    console.error('  1. Ensure the PostgreSQL user and database configured in DATABASE_URL exist.');
    console.error('     To create the default development credentials, run:');
    console.error("       sudo -u postgres psql -c \"CREATE USER ftth WITH PASSWORD 'change-me';\"");
    console.error("       sudo -u postgres psql -c \"CREATE DATABASE ftth_copilot OWNER ftth;\"");
    console.error("       sudo -u postgres psql -c \"GRANT ALL PRIVILEGES ON DATABASE ftth_copilot TO ftth;\"");
    console.error('  2. Or update DATABASE_URL in your root .env file to match your existing PostgreSQL setup.');
    if (composeCmd) {
      console.error('\nIf you intended to use Docker Compose:');
      console.error(`  A local PostgreSQL service on the host is occupying port ${port}, preventing Docker Compose.`);
      console.error('  Stop the local PostgreSQL service (e.g. sudo systemctl stop postgresql) and re-run `pnpm setup`.');
    }
    console.error('');
    process.exit(1);
  }

  // 4. Generate Prisma Client
  console.log('\n📦 Generating Prisma client...');
  execSync('pnpm --filter @ftth-copilot/db db:generate', {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });

  // 5. Seed database
  console.log('\n🌱 Seeding initial database data...');
  execSync('pnpm --filter @ftth-copilot/db db:seed', {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });

  console.log(`
====================================================
🎉 FTTH-Copilot bootstrap complete!
====================================================
Database:     ${host}:${port}
Migrations:   Up to date
LLM Provider: ${llmStatusMessage}
Default credentials:
  Tenant:      Demo ISP (demo-tenant)
  Admin email: admin@ftth-copilot.local
  Password:    (See one-time password in seed output above, or set SEED_ADMIN_PASSWORD)

You can now start the development server with:
  pnpm dev
====================================================
`);
}

main().catch((err) => {
  console.error('\n❌ Setup failed:', err);
  process.exit(1);
});
