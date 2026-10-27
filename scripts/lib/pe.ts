/**
 * Разбор PE-ресурсов (.rsrc) портативного .exe: иконка окна/файла и версия.
 *
 * Используется сборкой (`npm run build:windows`) и тестами, чтобы проверить,
 * что внутрь `eduflow-portable.exe` действительно попала иконка EduFlow
 * (дизайн №9), а не пустая заглушка.
 */

export interface PeResource {
  /** RT_ICON = 3, RT_GROUP_ICON = 14, RT_VERSION = 16. */
  type: number;
  id: number;
  language: number;
  data: Buffer;
}

export interface GroupIconEntry {
  width: number;
  height: number;
  colorCount: number;
  planes: number;
  bitCount: number;
  bytes: number;
  /** Идентификатор RT_ICON, на который ссылается группа. */
  iconId: number;
}

interface Section {
  virtualAddress: number;
  virtualSize: number;
  rawOffset: number;
  rawSize: number;
}

function readSections(exe: Buffer): { sections: Section[]; resourceRva: number; resourceSize: number } {
  if (exe.toString("ascii", 0, 2) !== "MZ") throw new Error("PE: нет MZ-заголовка");
  const peOffset = exe.readUInt32LE(0x3c);
  if (exe.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") throw new Error("PE: нет PE-заголовка");

  const optionalHeader = peOffset + 24;
  const magic = exe.readUInt16LE(optionalHeader);
  const is64 = magic === 0x20b;
  if (!is64 && magic !== 0x10b) throw new Error("PE: неизвестный optional header");

  const count = exe.readUInt16LE(peOffset + 6);
  const table = optionalHeader + exe.readUInt16LE(peOffset + 20);

  const sections: Section[] = [];
  for (let index = 0; index < count; index++) {
    const entry = table + index * 40;
    sections.push({
      virtualSize: exe.readUInt32LE(entry + 8),
      virtualAddress: exe.readUInt32LE(entry + 12),
      rawSize: exe.readUInt32LE(entry + 16),
      rawOffset: exe.readUInt32LE(entry + 20),
    });
  }

  // Каталог ресурсов — третья запись в DataDirectory (индекс 2).
  const dataDirectory = optionalHeader + (is64 ? 112 : 96);
  return {
    sections,
    resourceRva: exe.readUInt32LE(dataDirectory + 2 * 8),
    resourceSize: exe.readUInt32LE(dataDirectory + 2 * 8 + 4),
  };
}

function rvaToOffset(sections: Section[], rva: number): number {
  for (const section of sections) {
    const size = Math.max(section.virtualSize, section.rawSize);
    if (rva >= section.virtualAddress && rva < section.virtualAddress + size) {
      return section.rawOffset + (rva - section.virtualAddress);
    }
  }
  throw new Error(`PE: RVA 0x${rva.toString(16)} вне секций`);
}

/** Все ресурсы PE в виде плоского списка type/id/language → данные. */
export function readPeResources(exe: Buffer): PeResource[] {
  const { sections, resourceRva, resourceSize } = readSections(exe);
  if (resourceRva === 0 || resourceSize === 0) return [];

  const base = rvaToOffset(sections, resourceRva);
  const resources: PeResource[] = [];

  const walk = (directoryOffset: number, level: number, path: number[]): void => {
    const named = exe.readUInt16LE(directoryOffset + 12);
    const ids = exe.readUInt16LE(directoryOffset + 14);
    for (let index = 0; index < named + ids; index++) {
      const entry = directoryOffset + 16 + index * 8;
      const nameField = exe.readUInt32LE(entry);
      const target = exe.readUInt32LE(entry + 4);
      const isDirectory = (target & 0x80000000) !== 0;
      const value = nameField & 0x80000000 ? -1 : nameField;
      const nextPath = [...path, value];

      if (isDirectory) {
        walk(base + (target & 0x7fffffff), level + 1, nextPath);
        continue;
      }

      if (nextPath.length !== 3) continue;
      const dataEntry = base + target;
      const dataRva = exe.readUInt32LE(dataEntry);
      const size = exe.readUInt32LE(dataEntry + 4);
      const offset = rvaToOffset(sections, dataRva);
      resources.push({
        type: nextPath[0],
        id: nextPath[1],
        language: nextPath[2],
        data: exe.subarray(offset, offset + size),
      });
    }
  };

  walk(base, 0, []);
  return resources;
}

/** Разбирает RT_GROUP_ICON: какие RT_ICON и в каких размерах вшиты в .exe. */
export function readGroupIcon(data: Buffer): GroupIconEntry[] {
  const count = data.readUInt16LE(4);
  const entries: GroupIconEntry[] = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 14;
    entries.push({
      width: data.readUInt8(entry) || 256,
      height: data.readUInt8(entry + 1) || 256,
      colorCount: data.readUInt8(entry + 2),
      planes: data.readUInt16LE(entry + 4),
      bitCount: data.readUInt16LE(entry + 6),
      bytes: data.readUInt32LE(entry + 8),
      iconId: data.readUInt16LE(entry + 12),
    });
  }
  return entries;
}

/** Ширина и высота PNG-слоя иконки. */
export function readPngSize(data: Buffer): { width: number; height: number } {
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error("не PNG");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** Проверяет, что в .exe лежит полный набор иконки и версия EduFlow. */
export function inspectEduFlowIcon(exe: Buffer): {
  sizes: number[];
  hasVersionInfo: boolean;
} {
  const resources = readPeResources(exe);
  const groups = resources.filter((resource) => resource.type === 14);
  if (groups.length === 0) throw new Error("в .exe нет RT_GROUP_ICON — иконка не отобразится");

  const icons = new Map(
    resources.filter((resource) => resource.type === 3).map((resource) => [resource.id, resource.data]),
  );

  const sizes = readGroupIcon(groups[0].data).map((entry) => {
    const data = icons.get(entry.iconId);
    if (!data) throw new Error(`RT_GROUP_ICON ссылается на отсутствующий RT_ICON ${entry.iconId}`);
    if (data.length !== entry.bytes) {
      throw new Error(`RT_ICON ${entry.iconId}: размер в группе не совпадает с данными`);
    }
    const png = readPngSize(data);
    if (png.width !== entry.width || png.height !== entry.height) {
      throw new Error(`RT_ICON ${entry.iconId}: PNG ${png.width}×${png.height} ≠ заявленным ${entry.width}×${entry.height}`);
    }
    return png.width;
  });

  return {
    sizes,
    hasVersionInfo: resources.some((resource) => resource.type === 16),
  };
}
