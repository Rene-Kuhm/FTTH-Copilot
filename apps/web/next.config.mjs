/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@ftth-copilot/agent-core',
    '@ftth-copilot/shared',
    '@ftth-copilot/connectors-core',
    '@ftth-copilot/connectors-smartolt',
  ],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
