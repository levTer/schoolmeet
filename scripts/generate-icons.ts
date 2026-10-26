/**
 * Генерирует все растровые иконки EduFlow из единого public/icon.svg.
 *
 * Запуск: npm run icons:generate
 * SVG рендерится векторно через libvips в каждом целевом размере, без апскейла
 * готового растра. favicon.ico содержит независимые PNG-слои 16/32/48 px.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const SOURCE_PATH = path.join(PUBLIC_DIR, "icon.svg");

interface IcoImage {
  size: number;
  data: Buffer;
}

/** ICO поддерживает PNG-данные внутри записей (Windows Vista+ и все современные ОС). */
function encodeIco(images: IcoImage[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon resource
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size: полноцветное изображение
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}

async function main() {
  const svg = await readFile(SOURCE_PATH);

  const renderPng = (size: number, flatten = false): Promise<Buffer> => {
    let pipeline = sharp(svg, { density: 384 })
      .resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 });

    // Apple не принимает альфа-канал touch-иконок: подложка остаётся фирменной.
    if (flatten) pipeline = pipeline.flatten({ background: "#0F172A" });

    return pipeline
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toBuffer();
  };

  const [icon192, icon512, appleTouchIcon, favicon16, favicon32, favicon48] = await Promise.all([
    renderPng(192),
    renderPng(512),
    renderPng(180, true),
    renderPng(16),
    renderPng(32),
    renderPng(48),
  ]);

  await Promise.all([
    writeFile(path.join(PUBLIC_DIR, "icon-192.png"), icon192),
    writeFile(path.join(PUBLIC_DIR, "icon-512.png"), icon512),
    writeFile(path.join(PUBLIC_DIR, "apple-touch-icon.png"), appleTouchIcon),
    writeFile(
      path.join(PUBLIC_DIR, "favicon.ico"),
      encodeIco([
        { size: 16, data: favicon16 },
        { size: 32, data: favicon32 },
        { size: 48, data: favicon48 },
      ]),
    ),
    // Сохраняем старые адреса SVG для внешних ссылок и прежних деплоев.
    writeFile(path.join(PUBLIC_DIR, "icon-192.svg"), svg),
    writeFile(path.join(PUBLIC_DIR, "icon-512.svg"), svg),
  ]);

  console.log("EduFlow icons generated from public/icon.svg:");
  console.log("  icon-192.png, icon-512.png, apple-touch-icon.png (180×180)");
  console.log("  favicon.ico (16×16, 32×32, 48×48), icon-192.svg, icon-512.svg");
}

void main().catch((error: unknown) => {
  console.error("Не удалось сгенерировать иконки EduFlow:", error);
  process.exitCode = 1;
});
