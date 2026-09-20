import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import withPWA from '@ducanh2912/next-pwa';

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
  // Allow requests from the Tailscale IP we expose to the user for the demo.
  // Without this, Next 16 logs a warning when the host header isn't localhost.
  allowedDevOrigins: ['100.69.81.48', 'localhost'],
  // Turbopack config — empty to silence the webpack/turbopack conflict warning.
  // @ducanh2912/next-pwa requires webpack, so we set an empty turbopack config
  // to tell Next.js to fall back to webpack for this build.
  turbopack: {},
};

/**
 * PWA configuration.
 * - generateInDevMode: service worker available in dev for testing.
 * - disable: false in production; true only if NEXT_PUBLIC_DISABLE_PWA is set.
 * For Capacitor/Tauri: set NEXT_PUBLIC_PLATFORM=standalone to disable SW caching.
 */
const pwaConfig = withPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'production' && !!process.env.NEXT_PUBLIC_DISABLE_PWA,
  register: true,
  skipWaiting: true,
  scope: '/',
  sw: '/sw.js',
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts',
        expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|webp2)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'static-images',
        expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\/_next\/static\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'next-static',
        expiration: { maxEntries: 200, maxAgeSeconds: 365 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\/api\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-cache',
        expiration: { maxEntries: 50, maxAgeSeconds: 5 * 60 },
        networkTimeoutSeconds: 10,
      },
    },
  ],
  buildExcludes: [
    // Exclude static export artifacts from SW caching
    /\/data\.json$/,
    /manifest\.json$/,
  ],
});

const pwaExport = process.env.NEXT_PUBLIC_DISABLE_PWA === 'true'
  ? nextConfig
  : pwaConfig(nextConfig);

export default pwaExport;
