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

  if (envContent.includes('replace-with-a-random-32-byte-secret')) {
    const secret = crypto.randomBytes(32).toString('hex');
    envContent = envContent.replace('replace-with-a-random-32-byte-secret', secret);
    envUpdated = true;
    console.log('🔑 Generated secure JWT_SECRET in .env');
  }

  if (envContent.includes('replace-with-a-different-random-32-byte-secret')) {
    const secret = crypto.randomBytes(32).toString('hex');
    envContent = envContent.replace('replace-with-a-different-random-32-byte-secret', secret);
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

  // 2. Check PostgreSQL availability
  const { host, port } = parseDbHostPort(process.env.DATABASE_URL);
  console.log(`\n🔍 Checking PostgreSQL at ${host}:${port}...`);

  let isReachable = await checkTcpPort(host, port);

  if (!isReachable) {
    const composeCmd = getDockerComposeCommand();
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
  execSync('pnpm --filter @ftth-copilot/db db:deploy', {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });

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
Database:   ${host}:${port}
Migrations: Up to date
Default credentials:
  Tenant:      Demo ISP (demo-tenant)
  Admin email: admin@ftth-copilot.local
  Password:    admin123456

You can now start the development server with:
  pnpm dev
====================================================
`);
}

main().catch((err) => {
  console.error('\n❌ Setup failed:', err);
  process.exit(1);
});
