/**
 * Кодирование ICO для Windows: favicon.ico, иконка установщика
 * `public/eduflow-setup.exe` и окна Electron-приложения.
 *
 * Внутри ICO лежат независимые PNG-слои (Windows Vista+), поэтому иконка
 * рисуется векторно из `public/icon.svg` в каждом размере, без апскейла.
 */

import sharp from "sharp";

/** Размеры, которые Windows запрашивает для окна, панели задач и Проводника. */
export const WINDOWS_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

export interface IcoImage {
  size: number;
  data: Buffer;
}

/** Заголовок ICONDIR + ICONDIRENTRY на каждый слой (16 байт на запись). */
export function encodeIco(images: IcoImage[]): Buffer {
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

/** Рендерит SVG-логотип EduFlow в многослойный .ico. */
export async function renderIco(
  svg: Buffer,
  sizes: readonly number[] = WINDOWS_ICON_SIZES,
): Promise<Buffer> {
  const layers = await Promise.all(
    sizes.map(async (size) => ({
      size,
      data: await sharp(svg, { density: 384 })
        .resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
        .toBuffer(),
    })),
  );
  return encodeIco(layers);
}
