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

describe("спикер поверх демонстрации экрана (Filmstrip)", () => {
  const grid = readSource("src/components/meeting/VideoGrid.tsx");
  const room = readSource("src/components/meeting/MeetingRoom.tsx");
  const strip = readSource("src/components/meeting/Filmstrip.tsx");

  it("при демонстрации экрана сцена занимает место, участники — верхней полосой", () => {
    assert.match(grid, /screenTile/, "режим демонстрации экрана не учитывается");
    assert.match(grid, /<VideoTileView tile=\{screenTile\} stage muted=\{true\}/, "нет сцены демонстрации экрана");
    assert.match(room, /screenShareActive && !boardOpen && \(/, "нет верхней Filmstrip при экране");
    assert.match(strip, /h-20 .*md:h-24/, "полоска не в диапазоне 96–112px");
    assert.match(strip, /aria-pressed=\{pinned\}/, "плитка полосы не показывает состояние pin");
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
    assert.match(widget, /const MIN_WIDTH = 320/, "нет min-width: 320px");
    assert.match(widget, /const MIN_HEIGHT = 380/, "нет min-height: 380px");
    assert.match(widget, /MAX_VIEWPORT_FRACTION = 0\.95/, "нет max 95vw/95vh");
    assert.match(widget, /data-ai-resize-handle/, "нет ручки ресайза в правом нижнем углу");
    assert.match(widget, /cursor-nwse-resize/, "ручка ресайза без cursor-nwse-resize");
    assert.match(widget, /onResizeHandleMouseDown/, "ручка не отслеживает mousedown");
    assert.match(widget, /onResizeHandleTouchStart/, "ручка не отслеживает touchstart");
    assert.match(widget, /maxWidth: "95vw"/, "нет max-width: 95vw");
    assert.match(widget, /maxHeight: "95vh"/, "нет max-height: 95vh");
    assert.match(assistant, /flex-1 flex-grow .*overflow-y-auto|flex-grow .*overflow-y-auto/, "диалог не заполняет свободное пространство окна");
  });

  it("окно ИИ перетаскивается за шапку мышью и касанием", () => {
    assert.match(assistant, /cursor-grab/, "шапка окна ИИ не ручка перетаскивания");
    assert.match(assistant, /cursor-grabbing/, "нет курсора grabbing при перетаскивании");
    assert.match(widget, /onHeaderMouseDown/, "нет обработчика мыши для перетаскивания");
    assert.match(widget, /onHeaderTouchStart/, "нет обработчика касания для перетаскивания");
    assert.match(widget, /clientX/, "перетаскивание не отслеживает указатель");
    assert.match(widget, /setFrame\(\{/, "перетаскивание не обновляет позицию окна");
  });

  it("окно не уезжает за края viewport и не накрывает тулбар доски", () => {
    assert.match(widget, /function frameBounds/, "нет clamp-функции по границам viewport");
    assert.match(widget, /window\.innerWidth - w/, "нет clamp по ширине viewport");
    assert.match(widget, /window\.innerHeight - h/, "нет clamp по высоте viewport");
    assert.match(widget, /reservedTop/, "нет учёта верхней зоны (тулбар доски)");
    assert.match(room, /reservedTop=\{boardOpen \? WHITEBOARD_TOP_RESERVED_PX : undefined\}/, "комната не передаёт резерв верхней зоны при открытой доске");
    assert.match(board, /export const WHITEBOARD_TOP_RESERVED_PX/, "доска не экспортирует высоту служебной зоны");
  });

  it("кнопка «Развернуть на весь экран / Восстановить» — toggle с возвратом на последний кадр", () => {
    assert.match(widget, /inset-4 h-auto w-auto md:inset-8/, "нет полноэкранного режима окна ИИ");
    assert.match(widget, /lastFrameRef/, "Expand не запоминает последний размер/позицию");
    assert.match(widget, /toggleMaximized/, "нет переключателя Expand/Compress");
    assert.match(assistant, /Развернуть на весь экран/, "нет кнопки разворачивания окна");
    assert.match(assistant, /Shrink/, "иконка не меняется на Compress/Shrink");
  });

  it("z-index окна z-[200]: выше доски (z-50), НИЖЕ модалок (z-[999])", () => {
    assert.match(widget, /fixed z-\[200\]/, "окно ИИ не имеет z-[200]");
    assert.ok(!widget.includes("z-[1000]"), "полноэкранный режим снова выше модалок (z-[1000])");
    assert.match(board, /fixed inset-0 z-50/, "доска больше не на z-50");
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

describe("голосовой ввод ИИ (Web Speech API)", () => {
  const hook = readSource("src/hooks/useVoiceInput.ts");
  const assistant = readSource("src/components/meeting/AIAssistant.tsx");

  it("настройки распознавания: ru-RU, continuous: false, interimResults: true", () => {
    assert.match(hook, /recognition\.lang = lang/, "язык распознавания не выставляется");
    assert.match(hook, /recognition\.continuous = false/, "continuous не выключен");
    assert.match(hook, /recognition\.interimResults = true/, "interimResults не включены");
    assert.match(assistant, /useVoiceInput\(\{ lang: "ru-RU"/, "AI-панель не использует ru-RU");
  });

  it("при старте запрашивается микрофон, на onerror — понятная ошибка", () => {
    assert.match(hook, /getUserMedia\(\{ audio: true \}\)/, "нет явного запроса микрофона при старте");
    assert.match(hook, /NotAllowedError/, "отказ в доступе к микрофону не обрабатывается");
    assert.match(hook, /onerror/, "нет обработчика onerror");
  });

  it("fallback: без Web Speech API — disabled-кнопка и пояснение", () => {
    assert.match(hook, /webkitSpeechRecognition/, "нет fallback на webkitSpeechRecognition");
    assert.match(hook, /supported/, "хук не сообщает о поддержке API");
    assert.match(assistant, /disabled=\{!voice\.supported\}/, "кнопка микрофона не отключается без поддержки");
    assert.match(assistant, /!voice\.supported/, "нет пояснения, почему голосовой ввод недоступен");
  });

  it("ошибка распознавания показывается toast'ом, индикатор — пульсирующая точка", () => {
    assert.match(assistant, /toast\.error\(voice\.error\)/, "ошибка голосового ввода не показывается toast'ом");
    assert.match(assistant, /voice\.listening &&/, "нет блока «слушаю»");
    assert.match(assistant, /animate-pulse rounded-full bg-rose-500/, "нет пульсирующей красной точки");
  });
});

describe("Filmstrip: камеры участников при доске и демонстрации экрана", () => {
  const strip = readSource("src/components/meeting/Filmstrip.tsx");
  const grid = readSource("src/components/meeting/VideoGrid.tsx");
  const board = readSource("src/components/meeting/Whiteboard.tsx");
  const room = readSource("src/components/meeting/MeetingRoom.tsx");

  it("доска получает Filmstrip сверху, плитки кликабельны (Pin/Mute-индикаторы)", () => {
    assert.match(room, /topStrip=\{<Filmstrip/, "доска не получает Filmstrip");
    assert.match(strip, /MicOff/, "нет индикатора выключенного микрофона");
    assert.match(strip, /MonitorUp/, "нет индикатора демонстрации экрана");
    assert.match(strip, /onPin/, "плитки полосы не кликабельны (pin)");
  });

  it("тулбар доски остаётся под полосой видимым (shrink-0, полоса СВЕРХУ тулбара)", () => {
    assert.match(board, /topStrip && \(/, "доска не рендерит верхнюю полосу");
    const stripAt = board.indexOf("{topStrip && (");
    const toolbarAt = board.indexOf('role="toolbar"');
    assert.ok(stripAt > -1 && toolbarAt > -1, "не найдены полоса/тулбар в разметке доски");
    assert.ok(stripAt < toolbarAt, "полоса должна быть СВЕРХУ тулбара");
    assert.match(board.slice(stripAt, stripAt + 220), /shrink-0/, "полоса может сжаться и задвинуть тулбар");
  });

  it("треки не отключаются при переключении на доску", () => {
    for (const [name, source] of [["Filmstrip", strip], ["VideoGrid", grid], ["MeetingRoom", room]] as const) {
      assert.ok(!/\.enabled\s*=\s*false/.test(source), `${name}: трек выключается (enabled = false)`);
    }
    assert.match(grid, /muted=\{muted \?\? tile\.isLocal\}/, "сетка потеряла управление аудио");
  });

  it("двойного звука нет: при доске сетка silent, сцены экрана muted, полоса — источник аудио", () => {
    assert.match(grid, /silent = false/, "нет silent-режима сетки");
    assert.match(room, /silent=\{boardOpen\}/, "при доске сетка не переводится в silent");
    assert.match(strip, /muted=\{tile\.isLocal\}/, "полоса не стала источником аудио (muted только свой)");
  });
});
