/**
 * Сборка полноценного Windows-инсталлятора EduFlow: `public/eduflow-setup.exe`.
 *
 * Что происходит:
 *  1. Из единой иконки №9 (`public/icon.svg`) рендерятся `desktop/build/icon.ico`
 *     (слои 16…256 px) и `desktop/build/icon.png` — иконка окна и установщика.
 *  2. electron-builder собирает настоящий Electron-дистрибутив (Chromium +
 *     оболочка `desktop/`) и упаковывает его в NSIS-установщик для Windows x64.
 *  3. Готовый `eduflow-setup.exe` копируется в `public/` — оттуда его скачивает
 *     кнопка «💻 Скачать для Windows (.exe Установщик)».
 *  4. Файл проверяется: MZ/PE-заголовок, NSIS-сигнатура «Nullsoft», размер
 *     (полноценный Electron-инсталлятор весит десятки мегабайт — это защита от
 *     случайной подмены на микро-скрипт или пустую заглушку).
 *
 * Команда: npm run build:windows
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderIco } from "./lib/ico";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP_DIR = path.join(ROOT, "desktop");
const BUILD_DIR = path.join(DESKTOP_DIR, "build");
const ICON_ICO = path.join(BUILD_DIR, "icon.ico");
const ICON_PNG = path.join(BUILD_DIR, "icon.png");
/** Иконка окна приложения — попадает внутрь asar. */
const ASSETS_DIR = path.join(DESKTOP_DIR, "assets");
const WINDOW_ICON = path.join(ASSETS_DIR, "icon.png");
const OUTPUT_DIR = path.join(ROOT, "dist/electron");
const BUILT_EXE = path.join(OUTPUT_DIR, "eduflow-setup.exe");
const PUBLIC_EXE = path.join(ROOT, "public/eduflow-setup.exe");

/** Минимальный вес полноценного Electron-установщика. */
const MIN_SIZE_MB = 60;
/** Максимальный вес, чтобы установщик не разросся до неподъёмного. */
const MAX_SIZE_MB = 160;

async function renderIcons(): Promise<void> {
  mkdirSync(BUILD_DIR, { recursive: true });
  mkdirSync(ASSETS_DIR, { recursive: true });
  const svg = readFileSync(path.join(ROOT, "public/icon.svg"));

  const ico = await renderIco(svg);
  writeFileSync(ICON_ICO, ico);

  // Иконка окна Electron: PNG 512×512 (nativeImage не читает SVG).
  const sharp = (await import("sharp")).default;
  const png = await sharp(svg, { density: 512 }).resize(512, 512, { fit: "fill" }).png().toBuffer();
  writeFileSync(ICON_PNG, png);
  writeFileSync(WINDOW_ICON, png);

  console.log(
    `иконки: ${path.relative(ROOT, ICON_ICO)}, ${path.relative(ROOT, ICON_PNG)}, ${path.relative(ROOT, WINDOW_ICON)}`,
  );
}

function runElectronBuilder(): void {
  // Запускаем CLI через сам Node: на Windows `node_modules/.bin/electron-builder`
  // — это shell-скрипт без расширения, execFile его не запустит.
  const builderCli = path.join(ROOT, "node_modules", "electron-builder", "out", "cli", "cli.js");
  if (!existsSync(builderCli)) {
    throw new Error("electron-builder не установлен — выполните: npm install");
  }

  execFileSync(
    process.execPath,
    [builderCli, "--win", "nsis", "--x64", "--config", "electron-builder.yml", "--publish", "never"],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        // Стабильное имя артефакта независимо от платформы сборки.
        CSC_IDENTITY_AUTO_DISCOVERY: "false",
      },
    },
  );
}

/** Проверка, что получился настоящий Windows-инсталлятор, а не заглушка. */
function verifyInstaller(exe: Buffer): void {
  if (exe.subarray(0, 2).toString("ascii") !== "MZ") {
    throw new Error("eduflow-setup.exe: нет MZ-заголовка — это не Windows-исполняемый файл");
  }

  const peOffset = exe.readUInt32LE(0x3c);
  if (exe.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error("eduflow-setup.exe: нет PE-заголовка");
  }

  // Установщик NSIS: внутрь вшита сигнатура «NullsoftInst» и LZMA-архив.
  if (!exe.includes(Buffer.from("NullsoftInst", "ascii"))) {
    throw new Error("eduflow-setup.exe: не найден NSIS-загрузчик (NullsoftInst)");
  }

  const sizeMb = exe.length / (1024 * 1024);
  if (sizeMb < MIN_SIZE_MB) {
    throw new Error(
      `eduflow-setup.exe весит ${sizeMb.toFixed(1)} МБ — это не полноценный Electron-инсталлятор ` +
        `(ожидалось не меньше ${MIN_SIZE_MB} МБ)`,
    );
  }
  if (sizeMb > MAX_SIZE_MB) {
    throw new Error(`eduflow-setup.exe весит ${sizeMb.toFixed(1)} МБ — больше предела ${MAX_SIZE_MB} МБ`);
  }
}

async function main(): Promise<void> {
  await renderIcons();
  runElectronBuilder();

  if (!existsSync(BUILT_EXE)) {
    throw new Error(`electron-builder не создал ${path.relative(ROOT, BUILT_EXE)}`);
  }

  const exe = readFileSync(BUILT_EXE);
  verifyInstaller(exe);

  mkdirSync(path.dirname(PUBLIC_EXE), { recursive: true });
  copyFileSync(BUILT_EXE, PUBLIC_EXE);

  const sizeMb = (statSync(PUBLIC_EXE).size / (1024 * 1024)).toFixed(1);
  console.log("EduFlow для Windows установщик собран:");
  console.log(`  ${path.relative(ROOT, PUBLIC_EXE)} — ${sizeMb} МБ`);
  console.log("  движок: Electron (Chromium), NSIS-установщик, иконка №9");
  console.log("  адрес приложения: https://schoolmeet-vb96.onrender.com");
}

void main().catch((error: unknown) => {
  console.error("Не удалось собрать установщик EduFlow для Windows:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
