import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../.env');

if (fs.existsSync(rootEnvPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(rootEnvPath);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@ftth-copilot/agent-core',
    '@ftth-copilot/shared',
    '@ftth-copilot/connectors-core',
    '@ftth-copilot/connectors-mikrowisp',
    '@ftth-copilot/connectors-smartolt',
    '@ftth-copilot/analytics',
    '@ftth-copilot/detection',
    '@ftth-copilot/alerts',
    '@ftth-copilot/monitoring',
    '@ftth-copilot/security',
    '@ftth-copilot/soc',
  ],
  typedRoutes: true,
  output: 'standalone',
  // Allow requests from the Tailscale IP we expose to the user for the demo.
  // Without this, Next 16 logs a warning when the host header isn't localhost.
  allowedDevOrigins: ['100.69.81.48', 'localhost'],
};

export default nextConfig;
