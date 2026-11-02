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
  // ─────────────────────────────────────────────────────────────────────────
  // No explicit `any`.
  //
  // An `any` in a Prisma filter is the dangerous kind: it disables the
  // check that the field exists and that an enum value is inside the enum.
  // A filter built that way fails against the database, at runtime, and not
  // at compile time — a 500 in production for a request nobody tested.
  //
  // The rule is on error: `unknown` plus a narrowing is the way to say "I do
  // not know yet", and it keeps the compiler useful.
  //
  // The plugin and the parser come from `eslint-config-next`, which already
  // registers them: a flat config cannot redefine a plugin.
  // ─────────────────────────────────────────────────────────────────────────
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];

export default config;
