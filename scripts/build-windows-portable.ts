/**
 * Сборка портативной Windows-версии EduFlow: `public/eduflow-windows.zip`.
 *
 * Внутри архива:
 *   - `eduflow-portable.exe` — нативный Win32-лаунчер (≈90 КБ, без зависимостей),
 *     с иконкой EduFlow (дизайн №9) и свойствами файла;
 *   - `Как запустить.txt` — инструкция про SmartScreen.
 *
 * Почему не MSIX: неподписанный .msix Windows блокирует с ошибкой 0x800B010A
 * (нет доверенного сертификата издателя). Портативный .exe не требует ни
 * установки, ни прав администратора, ни платной подписи.
 *
 * Кросс-компиляция идёт через zig (clang + lld + rc), поэтому собрать архив
 * можно и на Linux/macOS, и на Windows:
 *   npm run build:windows
 *   npm run build:windows -- --zig=/usr/local/bin/zig
 *
 * Переменные окружения:
 *   ZIG              — путь к zig (иначе берётся `zig` из PATH)
 *   EDUFLOW_URL      — адрес приложения, вшитый в .exe по умолчанию
 *   SOURCE_DATE_EPOCH — фиксированная дата в ZIP ради воспроизводимости
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderIco } from "./lib/ico";
import { inspectEduFlowIcon } from "./lib/pe";
import { createZip, readZipEntries } from "./lib/zip";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(ROOT, "windows-portable");
const BUILD_DIR = path.join(SOURCE_DIR, "build");
const OUTPUT_ZIP = path.join(ROOT, "public/eduflow-windows.zip");
const EXE_NAME = "eduflow-portable.exe";
const INSTRUCTION_NAME = "Как запустить.txt";
const DEFAULT_URL = "https://schoolmeet-vb96.onrender.com";
const TARGET = "x86_64-windows-gnu";

function zigPath(): string {
  const fromArg = process.argv.find((argument) => argument.startsWith("--zig="));
  const candidates = [fromArg?.slice("--zig=".length), process.env.ZIG, "zig"].filter(
    (candidate): candidate is string => Boolean(candidate),
  );

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["version"], { stdio: "pipe" });
      return candidate;
    } catch {
      /* пробуем следующий вариант */
    }
  }

  throw new Error(
    "Не найден zig — компилятор для сборки eduflow-portable.exe.\n" +
      "Установите: pip install ziglang (или скачайте с https://ziglang.org/download/),\n" +
      "затем повторите: npm run build:windows -- --zig=/путь/к/zig",
  );
}

function runZig(zig: string, args: string[]): void {
  execFileSync(zig, args, { cwd: ROOT, stdio: "inherit" });
}

/** Минимальные проверки PE: GUI-подсистема, секция .rsrc с иконкой. */
function inspectPortableExe(exe: Buffer): { subsystem: number; hasResources: boolean } {
  if (exe.toString("ascii", 0, 2) !== "MZ") throw new Error("eduflow-portable.exe: нет MZ-заголовка");

  const peOffset = exe.readUInt32LE(0x3c);
  if (exe.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error("eduflow-portable.exe: нет PE-заголовка");
  }

  const optionalHeader = peOffset + 24;
  const optionalMagic = exe.readUInt16LE(optionalHeader);
  // 0x20b — PE32+, 0x10b — PE32. Подсистема лежит по одному и тому же смещению.
  if (optionalMagic !== 0x20b && optionalMagic !== 0x10b) {
    throw new Error("eduflow-portable.exe: неизвестный формат optional header");
  }
  const subsystem = exe.readUInt16LE(optionalHeader + 68);
  const sections = exe.readUInt16LE(peOffset + 6);
  const sectionTable = optionalHeader + exe.readUInt16LE(peOffset + 20);

  let hasResources = false;
  for (let index = 0; index < sections; index++) {
    const entry = sectionTable + index * 40;
    const name = exe.toString("ascii", entry, entry + 8).replace(/\0+$/, "");
    if (name === ".rsrc") hasResources = true;
  }

  return { subsystem, hasResources };
}

async function main(): Promise<void> {
  const zig = zigPath();
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")) as {
    version: string;
  };
  const version = packageJson.version;
  const url = process.env.EDUFLOW_URL?.trim() || DEFAULT_URL;

  await rm(BUILD_DIR, { recursive: true, force: true });
  await mkdir(BUILD_DIR, { recursive: true });

  // 1. Иконка EduFlow (дизайн №9) из единого SVG — 16…256 px в одном .ico.
  const svg = await readFile(path.join(ROOT, "public/icon.svg"));
  const iconPath = path.join(BUILD_DIR, "eduflow.ico");
  await writeFile(iconPath, await renderIco(svg));

  // 2. Ресурсы: иконка окна/файла и свойства «Подробнее → Файл».
  const [major, minor, patch] = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rcPath = path.join(BUILD_DIR, "launcher.rc");
  await writeFile(
    rcPath,
    `#include <winres.h>
1 ICON "eduflow.ico"
1 VERSIONINFO
FILEVERSION ${major},${minor},${patch},0
PRODUCTVERSION ${major},${minor},${patch},0
FILEFLAGSMASK 0x3fL
FILEFLAGS 0x0L
FILEOS 0x40004L
FILETYPE 0x1L
FILESUBTYPE 0x0L
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904b0"
    BEGIN
      VALUE "CompanyName", "EduFlow\\0"
      VALUE "FileDescription", "EduFlow — портативный лаунчер\\0"
      VALUE "FileVersion", "${version}\\0"
      VALUE "InternalName", "eduflow-portable\\0"
      VALUE "LegalCopyright", "EduFlow\\0"
      VALUE "OriginalFilename", "eduflow-portable.exe\\0"
      VALUE "ProductName", "EduFlow\\0"
      VALUE "ProductVersion", "${version}\\0"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x409, 1252
  END
END
`,
    "utf8",
  );

  // 3. Компиляция: `zig rc` собирает .res, `zig cc` — сам лаунчер.
  const resPath = path.join(BUILD_DIR, "launcher.res");
  runZig(zig, ["rc", rcPath, resPath]);

  const exePath = path.join(BUILD_DIR, EXE_NAME);
  runZig(zig, [
    "cc",
    `-target`,
    TARGET,
    "-Os",
    "-s",
    // GUI-подсистема: при запуске не появляется консольное окно.
    "-Wl,/subsystem:windows",
    `-DEDUFLOW_DEFAULT_URL=L"${url}"`,
    "-o",
    exePath,
    path.join(SOURCE_DIR, "launcher.c"),
    resPath,
  ]);

  const exe = await readFile(exePath);
  const { subsystem, hasResources } = inspectPortableExe(exe);
  if (subsystem !== 2) throw new Error(`ожидалась GUI-подсистема (2), получено ${subsystem}`);
  if (!hasResources) throw new Error("в .exe нет секции ресурсов .rsrc — иконка не встроится");

  // Иконка EduFlow (дизайн №9) должна быть полноценной: все слои + свойства файла.
  const icon = inspectEduFlowIcon(exe);
  for (const size of [16, 32, 48, 256]) {
    if (!icon.sizes.includes(size)) throw new Error(`в иконке .exe нет слоя ${size}×${size}`);
  }

  // 4. Архив: .exe + инструкция. Имена в UTF-8, дата фиксированная.
  const instruction = await readFile(path.join(SOURCE_DIR, "how-to-run.txt"));
  const epoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH ?? "", 10);
  const modifiedAt = Number.isFinite(epoch) ? new Date(epoch * 1000) : new Date(Date.UTC(2026, 0, 1));

  const zip = createZip(
    [
      // BOM — чтобы «Блокнот» в любой локали открыл инструкцию без кракозябр.
      { name: INSTRUCTION_NAME, data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), instruction]) },
      { name: EXE_NAME, data: exe },
    ],
    { modifiedAt },
  );
  await mkdir(path.dirname(OUTPUT_ZIP), { recursive: true });
  await writeFile(OUTPUT_ZIP, zip);

  const entries = readZipEntries(zip);
  if (!entries.some((entry) => entry.name === EXE_NAME)) throw new Error("в ZIP нет exe");
  if (!entries.some((entry) => entry.name === INSTRUCTION_NAME && entry.utf8)) {
    throw new Error("в ZIP нет UTF-8-записи «Как запустить.txt»");
  }

  console.log("EduFlow для Windows собран:");
  console.log(`  ${path.relative(ROOT, OUTPUT_ZIP)} (${(zip.length / 1024).toFixed(1)} КБ)`);
  console.log(`    ${EXE_NAME} — ${(exe.length / 1024).toFixed(1)} КБ, Windows GUI`);
  console.log(`    иконка: ${icon.sizes.join("/")} px${icon.hasVersionInfo ? " + свойства файла" : ""}`);
  console.log(`    ${INSTRUCTION_NAME}`);
  console.log(`  адрес по умолчанию: ${url}`);
  console.log(`  версия: ${version}`);
}

void main().catch((error: unknown) => {
  console.error("Не удалось собрать портативную версию EduFlow для Windows:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
