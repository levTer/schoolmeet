/**
 * Хук electron-builder: облегчает дистрибутив Electron перед упаковкой в NSIS.
 *
 * Chromium поставляется со всеми локалями и программным рендерингом Vulkan —
 * приложению EduFlow они не нужны. Каждый удалённый мегабайт в распакованном
 * виде экономит ~30% веса установщика:
 *   • `locales/*.pak` кроме русской и английской — ≈40 МБ;
 *   • `swiftshader/` + `vk_swiftshader*.dll` — ≈15 МБ;
 *   • `LICENSES.chromium.html` — ≈9 МБ.
 *
 * Итоговый `eduflow-setup.exe` остаётся полноценным Electron-приложением, но
 * укладывается в ~80–100 МБ и не превышает лимит GitHub на размер файла.
 */
const { readdirSync, rmSync, statSync } = require("node:fs");
const path = require("node:path");

/** Локали, которые остаются в сборке (остальные удаляются). */
const KEEP_LOCALES = new Set(["ru.pak", "en-US.pak"]);
/** Файлы Chromium, не нужные приложению. */
const DROP_FILES = ["LICENSES.chromium.html", "vk_swiftshader.dll", "vk_swiftshader_icd.json"];
/** Каталоги Chromium, не нужные приложению. */
const DROP_DIRS = ["swiftshader"];

function sizeOf(target) {
  try {
    const stat = statSync(target);
    if (stat.isFile()) return stat.size;
    return readdirSync(target).reduce((total, name) => total + sizeOf(path.join(target, name)), 0);
  } catch {
    return 0;
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const appOutDir = context.appOutDir;
  let removedBytes = 0;

  const localesDir = path.join(appOutDir, "locales");
  try {
    for (const file of readdirSync(localesDir)) {
      if (KEEP_LOCALES.has(file)) continue;
      const target = path.join(localesDir, file);
      removedBytes += sizeOf(target);
      rmSync(target, { force: true });
    }
  } catch {
    /* каталога локалей может не быть — не критично */
  }

  for (const name of DROP_FILES) {
    const target = path.join(appOutDir, name);
    removedBytes += sizeOf(target);
    rmSync(target, { force: true });
  }

  for (const name of DROP_DIRS) {
    const target = path.join(appOutDir, name);
    removedBytes += sizeOf(target);
    rmSync(target, { recursive: true, force: true });
  }

  // Крупнейшие файлы дистрибутива — по этому отчёту видно, что ещё можно ужать.
  const largest = readdirSync(appOutDir)
    .map((name) => ({ name, size: sizeOf(path.join(appOutDir, name)) }))
    .sort((left, right) => right.size - left.size)
    .slice(0, 8)
    .map((entry) => `${entry.name}=${(entry.size / (1024 * 1024)).toFixed(1)}MB`)
    .join(", ");

  console.log(
    `[afterPack] удалено ${(removedBytes / (1024 * 1024)).toFixed(1)} МБ лишних файлов Chromium; ` +
      `размер дистрибутива ${(sizeOf(appOutDir) / (1024 * 1024)).toFixed(1)} МБ; крупнейшее: ${largest}`,
  );
};
