// ESLint v9 flat config for the Next.js web app.
// eslint-config-next@16.x exports a flat config array directly,
// so we just spread it into our config.
import nextConfig from "eslint-config-next/core-web-vitals";

const config = [
  // Exclude generated/build artifacts from linting.
  {
    ignores: [".next/**", ".turbo/**", "node_modules/**", "out/**", "coverage/**"],
  },
  ...nextConfig,
];

export default config;