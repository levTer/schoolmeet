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

/* -------------------------------------------------------------------------- */
/* UX урока: окно ДЗ, запись, спикер поверх экрана, глобальный ИИ            */
/* -------------------------------------------------------------------------- */

describe("окно создания ДЗ сбалансировано", () => {
  const source = readSource("src/components/homework/homework-create-modal.tsx");

  it("карточка ограничена по ширине и высоте и не вылезает за экран", () => {
    assert.match(source, /w-full max-w-3xl md:max-w-4xl/, "нет гармоничной ширины карточки");
    assert.match(source, /max-h-\[85vh\] flex flex-col/, "нет ограничения по высоте и flex-колонки");
  });

  it("форма прокручивается внутри карточки, а не обрезается", () => {
    assert.match(
      source,
      /overflow-y-auto custom-scrollbar p-6 space-y-4/,
      "нет прокручиваемой области с тонким скроллбаром",
    );
  });

  it("поле «Название задания» внутри прокручиваемой области и с отбивкой сверху", () => {
    const scrollAt = source.indexOf("overflow-y-auto custom-scrollbar p-6 space-y-4");
    const titleAt = source.indexOf('label="Название задания"');

    assert.ok(scrollAt > -1, "нет прокручиваемой области");
    assert.ok(titleAt > scrollAt, "поле «Название задания» вне прокручиваемой области");
    assert.match(
      source.slice(scrollAt, titleAt),
      /pt-2/,
      "у названия задания нет верхней отбивки pt-2 — заголовок липнет к краю",
    );
  });
});

describe("локальная запись урока (WebM)", () => {
  const recorder = readSource("src/hooks/useLessonRecorder.ts");
  const controls = readSource("src/components/meeting/Controls.tsx");
  const room = readSource("src/components/meeting/MeetingRoom.tsx");

  it("формат записи: vp9+opus с откатом на обычный webm", () => {
    assert.match(recorder, /video\/webm; codecs=vp9,opus/, "нет основного формата записи");
    assert.match(recorder, /"video\/webm"/, "нет отката на video/webm");
    assert.match(recorder, /MediaRecorder/, "запись идёт не через MediaRecorder");
  });

  it("файл сохраняется на компьютер как schoolmeet-lesson-[дата].webm", () => {
    assert.match(recorder, /schoolmeet-lesson-/, "нет шаблона имени файла");
    assert.match(recorder, /\.webm/, "нет расширения .webm");
    assert.match(recorder, /download\s*=/, "файл не скачивается на компьютер");
  });

  it("в панели управления урока есть кнопка «Запись» с красной точкой", () => {
    assert.match(controls, /Запись/, "нет кнопки «Запись»");
    assert.match(controls, /bg-rose-500/, "нет красной индикаторной точки");
    assert.match(room, /onToggleRecording/, "комната не передаёт переключатель записи");
    assert.match(room, /useLessonRecorder/, "комната не использует локальную запись");
  });
});

describe("спикер поверх демонстрации экрана", () => {
  const grid = readSource("src/components/meeting/VideoGrid.tsx");
  const room = readSource("src/components/meeting/MeetingRoom.tsx");

  it("картинка спикера закреплена в правом нижнем углу поверх экрана", () => {
    assert.match(
      grid,
      /absolute bottom-4 right-4 z-20 w-48 md:w-64 rounded-xl shadow-2xl border border-slate-700/,
      "нет картинки спикера в правом нижнем углу",
    );
    assert.match(grid, /screenOn/, "режим демонстрации экрана не учитывается");
  });

  it("на карточках участников есть кнопка «Закрепить спикера»", () => {
    assert.match(grid, /Закрепить спикера/, "нет кнопки закрепления спикера");
    assert.match(grid, /onPin/, "закрепление спикера не пробрасывается наверх");
    assert.match(room, /pinnedId=\{pinnedId\}/, "комната не хранит закреплённого спикера");
  });
});

describe("глобальный минималистичный ИИ-ассистент", () => {
  const widget = readSource("src/components/meeting/AIWidget.tsx");
  const assistant = readSource("src/components/meeting/AIAssistant.tsx");
  const board = readSource("src/components/meeting/Whiteboard.tsx");
  const room = readSource("src/components/meeting/MeetingRoom.tsx");

  it("окно ИИ ресайзабельное и не меньше 320×380", () => {
    assert.match(widget, /resize: "both"/, "окно ИИ не ресайзабельное");
    assert.match(widget, /overflow: "hidden"/, "нет overflow: hidden для ресайза");
    assert.match(widget, /minWidth: 320/, "нет min-width: 320px");
    assert.match(widget, /minHeight: 380/, "нет min-height: 380px");
    assert.match(widget, /maxWidth: "95vw"/, "нет max-width: 95vw");
    assert.match(widget, /maxHeight: "95vh"/, "нет max-height: 95vh");
    assert.match(assistant, /flex-1 flex-grow .*overflow-y-auto|flex-grow .*overflow-y-auto/, "диалог не заполняет свободное пространство окна");
  });

  it("окно ИИ перетаскивается за шапку мышью и касанием", () => {
    assert.match(assistant, /cursor-grab/, "шапка окна ИИ не ручка перетаскивания");
    assert.match(assistant, /cursor-grabbing/, "нет курсора grabbing при перетаскивании");
    assert.match(widget, /onMouseDown/, "нет обработчика мыши для перетаскивания");
    assert.match(widget, /onTouchStart/, "нет обработчика касания для перетаскивания");
    assert.match(widget, /clientX/, "перетаскивание не отслеживает указатель");
    assert.match(widget, /setPosition\(\{/, "перетаскивание не обновляет позицию окна");
  });

  it("кнопка «Развернуть на весь экран / Восстановить» есть в шапке", () => {
    assert.match(widget, /inset-4 z-\[1000\] h-auto w-auto md:inset-8/, "нет полноэкранного режима окна ИИ");
    assert.match(assistant, /Развернуть на весь экран/, "нет кнопки разворачивания окна");
    assert.match(assistant, /Shrink/, "иконка не меняется на Compress/Shrink");
  });

  it("ИИ-виджет доступен с любой страницы урока (плавающая кнопка)", () => {
    assert.match(widget, /fixed bottom-24 right-4/, "нет плавающей кнопки в углу экрана");
    assert.match(room, /<AIWidget/, "виджет не подключён к странице урока");
  });

  it("громкие чипсы-подсказки спрятаны под одной кнопкой «Идеи запросов»", () => {
    assert.match(assistant, /Идеи запросов/, "нет кнопки «Идеи запросов»");
    assert.ok(
      !assistant.includes("Zap"),
      "громкий блок «Быстрые подсказки» снова появился в потоке чата",
    );
  });

  it("доска не держит собственную ИИ-панель — ассистент глобальный", () => {
    assert.ok(!board.includes("<AIAssistant"), "доска снова рендерит отдельную ИИ-панель");
    assert.match(board, /onAiBridge/, "доска не отдаёт мост глобальному ИИ");
  });
});
