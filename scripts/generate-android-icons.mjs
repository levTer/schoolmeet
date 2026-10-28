/** Regenerate all Android launcher and splash bitmaps from logo option #9. */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = path.join(root, 'android/app/src/main/res');
const svg = await readFile(path.join(root, 'public/icon.svg'));
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [density, scale] of Object.entries(densities)) {
  const dir = path.join(res, `mipmap-${density}`);
  await mkdir(dir, { recursive: true });
  const size = Math.round(48 * scale);
  await sharp(svg, { density: 512 }).resize(size, size).png().toFile(path.join(dir, 'ic_launcher.png'));
  // 72dp artwork on a 108dp transparent canvas: inside the adaptive safe zone.
  const canvas = Math.round(108 * scale);
  const markSize = Math.round(72 * scale);
  const mark = await sharp(svg, { density: 512 }).resize(markSize, markSize).png().toBuffer();
  await sharp({ create: { width: canvas, height: canvas, channels: 4, background: '#00000000' } })
    .composite([{ input: mark, gravity: 'centre' }]).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
}
await mkdir(path.join(res, 'drawable-nodpi'), { recursive: true });
await sharp(svg, { density: 512 }).resize(432, 432).png().toFile(path.join(res, 'drawable-nodpi/splash_logo.png'));
console.log('Android icons and splash regenerated from public/icon.svg');
