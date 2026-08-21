/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@ftth-copilot/agent-core',
    '@ftth-copilot/shared',
    '@ftth-copilot/connectors-core',
    '@ftth-copilot/connectors-mikrowisp',
    '@ftth-copilot/connectors-smartolt',
  ],
  typedRoutes: true,
  // Allow requests from the Tailscale IP we expose to the user for the demo.
  // Without this, Next 16 logs a warning when the host header isn't localhost.
  allowedDevOrigins: ['100.69.81.48', 'localhost'],
};

export default nextConfig;
