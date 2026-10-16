/**
 * Тесты «железобетонной» вёрстки модальных окон.
 * Запуск: `npm run test:ui`. Браузер и база данных не нужны.
 *
 * Модалка ДЗ однажды «поехала»: карточка растянулась на всю ширину и обрезалась
 * по высоте. Чтобы регрессия не вернулась, здесь зафиксирован эталонный паттерн
 * обёрток (подложка → центрирующий контейнер → карточка) и требование, чтобы
 * модалки домашних заданий использовали общий компонент `<Modal>` вместо
 * собственной разметки оверлея.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/** Все строковые литералы с классами из фрагмента исходника. */
function classChunks(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*)"/g)].map((match) => match[1]);
}

/**
 * Классы одного слоя обёртки.
 *
 * Слой описан экспортируемой константой (`MODAL_OVERLAY_CLASS` и т. п.), внутри
 * которой могут быть строковые литералы и ссылки на другие константы
 * (`MODAL_OVERLAY_Z_INDEX`). Раскрываем всё дерево и возвращаем плоский список
 * классов — ровно то, что в рантайме соберёт `cn(...)`.
 */
function layerClasses(source: string, name: string): string[] {
  return resolveConstant(source, name)
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Значение экспортированной константы с классами.
 *
 * Границу выражения ищем по балансу скобок: значение бывает многострочным и
 * само содержит `cn(...)`, поэтому первая `;` внутри вызова нас не устраивает.
 */
function resolveConstant(source: string, name: string): string {
  const marker = `export const ${name} = `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `константа ${name} не найдена в src/components/ui/modal.tsx`);

  let depth = 0;
  let end = -1;
  for (let cursor = start + marker.length; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if ((char === ";" || char === "\n") && depth === 0) {
      end = cursor;
      break;
    }
  }
  assert.notEqual(end, -1, `не удалось найти конец константы ${name}`);

  const value = source.slice(start + marker.length, end);
  const nested = [...value.matchAll(/\bMODAL_[A-Z_]+\b/g)]
    .map((match) => match[0])
    .filter((item) => item !== name);
  return [classChunks(value).join(" "), ...nested.map((item) => resolveConstant(source, item))].join(" ");
}

const MODAL_SOURCE_PATH = "src/components/ui/modal.tsx";

const OVERLAY_REQUIRED = [
  "fixed",
  "inset-0",
  "z-[999]",
  "bg-black/80",
  "backdrop-blur-sm",
  "overflow-y-auto",
];

const CONTAINER_REQUIRED = [
  "flex",
  "min-h-full",
  "items-center",
  "justify-center",
  "p-4",
  "text-center",
  "sm:p-0",
];

const CARD_REQUIRED = [
  "relative",
  "transform",
  "overflow-hidden",
  "rounded-2xl",
  "bg-slate-900",
  "text-left",
  "shadow-xl",
  "transition-all",
  "border",
  "border-slate-800",
  "sm:my-8",
  "sm:w-full",
  "sm:max-w-2xl",
];

describe("каркас модалки (src/components/ui/modal.tsx)", () => {
  const source = readSource(MODAL_SOURCE_PATH);
  const overlay = layerClasses(source, "MODAL_OVERLAY_CLASS");
  const container = layerClasses(source, "MODAL_CONTAINER_CLASS");
  const card = layerClasses(source, "MODAL_CARD_CLASS");

  it("подложка: fixed inset-0, z-[999], затемнение с блюром и собственный скролл", () => {
    for (const expected of OVERLAY_REQUIRED) {
      assert.ok(overlay.includes(expected), `в подложке не хватает класса ${expected}`);
    }
  });

  it("центрирующий контейнер: flex min-h-full + p-4 (sm:p-0) — карточка не растягивается и не обрезается", () => {
    for (const expected of CONTAINER_REQUIRED) {
      assert.ok(container.includes(expected), `в контейнере не хватает класса ${expected}`);
    }
  });

  it("карточка: relative, max-w-2xl на sm+, text-left и border-slate-800", () => {
    for (const expected of CARD_REQUIRED) {
      assert.ok(card.includes(expected), `в карточке не хватает класса ${expected}`);
    }
  });

  it("карточка ограничена по ширине на всех брейкпоинтах (w-full + max-w-* на sm)", () => {
    assert.ok(card.includes("sm:w-full"), "нет sm:w-full");
    assert.ok(
      card.some((item) => /^sm:max-w-/.test(item)),
      "нет sm:max-w-* — карточка растянется на весь экран",
    );
  });

  it("подложка выше шапки (z-50) и панелей админки (z-[100])", () => {
    const zIndex = overlay.find((item) => /^z-\[\d+\]$/.test(item));
    assert.ok(zIndex, "у подложки нет явного z-[…] — модалка может оказаться под шапкой");
    const level = Number(zIndex.match(/\d+/)?.[0]);
    assert.ok(level > 100, `z-индекс оверлея ${zIndex} слишком низкий`);
  });

  it("модалка закрывается по Escape и клику на подложку и не даёт странице скроллиться", () => {
    assert.match(source, /event\.key !== "Escape"/, "нет обработки Escape");
    assert.match(source, /event\.target === event\.currentTarget/, "нет закрытия по клику на подложку");
    assert.match(source, /document\.body\.style\.overflow = "hidden"/, "страница под модалкой прокручивается");
    assert.match(source, /aria-modal="true"/, "нет aria-modal");
    assert.match(source, /role="dialog"/, "нет role=dialog");
  });

  it("закрытая модалка ничего не рендерит", () => {
    assert.match(source, /if \(!open\) return null;/, "закрытая модалка остаётся в DOM");
  });
});

describe("модалки домашних заданий используют общий каркас", () => {
  const HOMEWORK_SOURCES = [
    "src/components/homework/homework-create-modal.tsx",
    "src/components/homework/student-homework-view.tsx",
    "src/components/homework/teacher-homework-view.tsx",
    "src/components/homework/homework-card.tsx",
  ];

  it("ни одна модалка ДЗ не верстает оверлей вручную", () => {
    for (const path of HOMEWORK_SOURCES) {
      const source = readSource(path);
      assert.ok(
        !source.includes("fixed inset-0"),
        `${path}: найден собственный fixed inset-0 оверлей — используйте <Modal> из @/components/ui/modal`,
      );
    }
  });

  it("модалка создания задания собрана из <Modal>", () => {
    const source = readSource("src/components/homework/homework-create-modal.tsx");
    assert.match(source, /import \{ Modal \} from "@\/components\/ui\/modal";/, "нет импорта <Modal>");
    assert.match(source, /<Modal\b/, "модалка не использует <Modal>");
    assert.match(source, /labelledBy="homework-modal-title"/, "у модалки нет связи с заголовком");
    assert.match(source, /disableClose=\{submitting\}/, "модалку можно закрыть во время отправки формы");
  });
});
