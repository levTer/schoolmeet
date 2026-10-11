import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Локальное хранилище файлов домашних заданий.
 *
 * Файлы лежат вне публичной папки Next.js и отдаются только через авторизованный
 * маршрут `/api/homework/[id]/files/[fileId]`. Имя файла на диске генерирует
 * сервер (UUID), поэтому пользовательское имя никогда не участвует в путях.
 * Каталог задаётся переменной `UPLOAD_DIR` (по умолчанию `storage/uploads`).
 */

const DEFAULT_UPLOAD_DIR = path.join(process.cwd(), "storage", "uploads");

function getUploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR);
}

/** Сохраняет файл и возвращает ключ хранения (имя файла на диске). */
export async function saveUpload(bytes: Uint8Array, extension: string): Promise<string> {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const storageKey = safeExtension ? `${randomUUID()}.${safeExtension}` : randomUUID();

  const dir = getUploadDir();
  await mkdir(dir, { recursive: true });
  await writeFile(resolveStoragePath(storageKey), bytes, { flag: "wx" });
  return storageKey;
}

export async function readUpload(storageKey: string): Promise<Buffer> {
  return readFile(resolveStoragePath(storageKey));
}

/** Удаляет файл; отсутствующий файл не считается ошибкой. */
export async function deleteUpload(storageKey: string): Promise<void> {
  try {
    await unlink(resolveStoragePath(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Защита от выхода за пределы каталога: ключ должен быть простым именем файла. */
function resolveStoragePath(storageKey: string): string {
  if (!/^[a-zA-Z0-9-]+(\.[a-z0-9]+)?$/.test(storageKey)) {
    throw new Error("Некорректный ключ хранения файла");
  }
  const dir = getUploadDir();
  const target = path.join(dir, storageKey);
  if (path.dirname(target) !== dir) {
    throw new Error("Некорректный путь к файлу");
  }
  return target;
}
