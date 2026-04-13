// Generates public/icon-192.png and public/icon-512.png
// from public/logo.png on a solid #030712 (app background) square.
// Run once with: node scripts/generate-icons.mjs

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const logoPath = path.join(root, 'public', 'logo.png');

async function makeIcon(size) {
  // Work out how large the logo should be inside the square.
  // Leave ~20% padding on each side so it looks good as a rounded app icon.
  const logoSize = Math.round(size * 0.60);
  const offset   = Math.round((size - logoSize) / 2);

  // Background: solid dark square matching the app's bg
  const bg = {
    create: { width: size, height: size, channels: 4,
              background: { r: 3, g: 7, b: 18, alpha: 1 } },
  };

  const resizedLogo = await sharp(logoPath)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp(bg)
    .composite([{ input: resizedLogo, left: offset, top: offset }])
    .png()
    .toFile(path.join(root, 'public', `icon-${size}.png`));

  console.log(`✓ icon-${size}.png`);
}

await makeIcon(192);
await makeIcon(512);
console.log('Done — icons written to public/');
