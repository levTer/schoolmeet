/**
 * Минимальный детерминированный писатель ZIP-архивов (deflate, без зависимостей).
 *
 * Нужен для `public/eduflow-windows.zip`: архив собирается одинаковым на любой
 * машине (фиксированная дата, никаких лишних полей), а имена файлов помечаются
 * флагом UTF-8 (general purpose bit 11), иначе Windows покажет «Как запустить.txt»
 * как «ÐšÐ°Ðº Ð·Ð°Ð¿ÑƒÑ Ñ‚Ð¸Ñ‚ÑŒ.txt».
 */

import { deflateRawSync, inflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Имя внутри архива, UTF-8. */
  name: string;
  data: Buffer;
}

export interface ZipOptions {
  /** Дата изменения для всех записей — фиксируется ради воспроизводимости сборки. */
  modifiedAt?: Date;
}

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_NAME_FLAG = 0x0800;
const DEFLATE_METHOD = 8;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 20;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Дата в формате MS-DOS: время 2-байтовое, дата 2-байтовая, с 1980 года. */
function dosTimestamp(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time:
      (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export function createZip(entries: ZipEntry[], options: ZipOptions = {}): Buffer {
  const timestamp = dosTimestamp(options.modifiedAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));

  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(UTF8_NAME_FLAG, 6);
    local.writeUInt16LE(DEFLATE_METHOD, 8);
    local.writeUInt16LE(timestamp.time, 10);
    local.writeUInt16LE(timestamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
    header.writeUInt16LE(VERSION_MADE_BY, 4);
    header.writeUInt16LE(VERSION_NEEDED, 6);
    header.writeUInt16LE(UTF8_NAME_FLAG, 8);
    header.writeUInt16LE(DEFLATE_METHOD, 10);
    header.writeUInt16LE(timestamp.time, 12);
    header.writeUInt16LE(timestamp.date, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30); // extra field length
    header.writeUInt16LE(0, 32); // comment length
    header.writeUInt16LE(0, 34); // disk number start
    header.writeUInt16LE(0, 36); // internal attributes
    header.writeUInt32LE(0, 38); // external attributes
    header.writeUInt32LE(offset, 42);

    locals.push(local, name, compressed);
    central.push(header, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
}

/** Разбор центрального каталога — используется тестами для проверки архива. */
export function readZipEntries(zip: Buffer): Array<{
  name: string;
  crc: number;
  compressedSize: number;
  size: number;
  utf8: boolean;
}> {
  const endOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) throw new Error("ZIP: не найден EOCD");
  const count = zip.readUInt16LE(endOffset + 10);
  let cursor = zip.readUInt32LE(endOffset + 16);

  const entries: Array<{
    name: string;
    crc: number;
    compressedSize: number;
    size: number;
    utf8: boolean;
  }> = [];

  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error("ZIP: повреждён центральный каталог");
    }
    const flags = zip.readUInt16LE(cursor + 8);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    entries.push({
      name: zip.toString("utf8", cursor + 46, cursor + 46 + nameLength),
      crc: zip.readUInt32LE(cursor + 16),
      compressedSize: zip.readUInt32LE(cursor + 20),
      size: zip.readUInt32LE(cursor + 24),
      utf8: (flags & UTF8_NAME_FLAG) !== 0,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Достаёт и распаковывает одну запись по имени (deflate/store). */
export function extractZipEntry(zip: Buffer, name: string): Buffer {
  const endOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) throw new Error("ZIP: не найден EOCD");
  const count = zip.readUInt16LE(endOffset + 10);
  let cursor = zip.readUInt32LE(endOffset + 16);

  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error("ZIP: повреждён центральный каталог");
    }
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const entryName = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    if (entryName === name) {
      if (zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
        throw new Error(`ZIP: повреждён локальный заголовок ${name}`);
      }
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const payload = zip.subarray(start, start + compressedSize);
      return method === DEFLATE_METHOD ? inflateRawSync(payload) : Buffer.from(payload);
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`ZIP: нет записи ${name}`);
}
