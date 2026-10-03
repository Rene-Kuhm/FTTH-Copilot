#!/usr/bin/env tsx
/**
 * Generate PWA icons from SVG source.
 * Run: pnpm --filter @ftth-copilot/web exec tsx scripts/generate-icons.ts
 */
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const SOURCE = path.join(import.meta.dirname, '../public/icons/icon.svg');
const OUT_DIR = path.join(import.meta.dirname, '../public/icons');

async function main() {
  const svg = fs.readFileSync(SOURCE);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await Promise.all(
    SIZES.map(async (size) => {
      const out = path.join(OUT_DIR, `icon-${size}.png`);
      await sharp(svg)
        .resize(size, size, { fit: 'contain', background: { r: 26, g: 18, b: 24, alpha: 1 } })
        .png()
        .toFile(out);
      console.log(`✓ icon-${size}.png`);
    }),
  );

  // Maskable icon (icon-512 with padding for safe zone)
  await sharp(svg)
    .resize(512, 512, { fit: 'contain', background: { r: 26, g: 18, b: 24, alpha: 1 } })
    .png()
    .toFile(path.join(OUT_DIR, 'icon-512-maskable.png'));
  console.log('✓ icon-512-maskable.png (maskable)');

  console.log('\nAll icons generated successfully.');
}

main().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
