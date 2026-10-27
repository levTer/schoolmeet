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
import { inflateSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { renderIco } from "./lib/ico";

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

  it("файл сохраняется на компьютер как eduflow-lesson-[дата].webm", () => {
    assert.match(recorder, /eduflow-lesson-/, "нет шаблона имени файла");
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

  it("при демонстрации экрана сцена занимает место, участники — полосой/колонкой", () => {
    assert.match(grid, /screenTile/, "режим демонстрации экрана не учитывается");
    assert.match(grid, /<VideoTileView tile=\{screenTile\} stage muted=\{true\}/, "нет сцены демонстрации экрана");
    assert.match(room, /screenShareActive && !boardOpen/, "комната не обрабатывает демонстрацию экрана при закрытой доске");
    assert.match(strip, /h-20 .*md:h-24/, "полоска не в диапазоне 96–112px");
    assert.match(strip, /aria-pressed=\{pinned\}/, "плитка полосы не показывает состояние pin");
  });

  it("на карточках участников есть кнопка «Закрепить спикера»", () => {
    assert.match(grid, /Закрепить спикера/, "нет кнопки закрепления спикера");
    assert.match(grid, /onPin/, "закрепление спикера не пробрасывается наверх");
    assert.match(room, /pinnedIds=\{pinnedIds\}/, "комната не хранит закреплённых спикеров");
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

  it("старт и остановка записи обёрнуты в try/catch (без uncaught exception)", () => {
    assert.match(hook, /function safeCall\(/, "нет безопасного вызова методов SpeechRecognition");
    assert.match(hook, /try \{\s*recognition\.stop\(\);\s*\} catch/, "stop() не обёрнут в try/catch");
    assert.match(hook, /safeCall\(\(\) => recognition\.start\(\)\)/, "start() не обёрнут в try/catch");
    assert.match(hook, /recognition\.onerror = \(event\) => \{\s*try \{/, "onerror не защищён try/catch");
    assert.match(assistant, /const toggleVoice = useCallback\(\(\) => \{\s*try \{/, "кнопка «Голос» не обёрнута в try/catch");
    assert.match(assistant, /toast\.error\("Разрешите доступ к микрофону в настройках браузера\."\)/, "нет аккуратного тоста при сбое микрофона");
  });

  it("onerror перехватывает not-allowed / no-speech / audio-capture / network / aborted", () => {
    for (const code of ["not-allowed", "no-speech", "audio-capture", "network", "aborted"]) {
      assert.ok(hook.includes(`"${code}"`) || hook.includes(`${code}:`), `ошибка ${code} не обрабатывается`);
    }
    assert.match(
      hook,
      /Разрешите доступ к микрофону в настройках браузера/,
      "нет понятной подсказки про разрешение микрофона",
    );
  });

  it("listening сбрасывается при ошибке и завершении записи (нет «already started»)", () => {
    assert.match(hook, /recognition\.onend = \(\) => \{[\s\S]{0,400}?setListening\(false\)/, "onend не сбрасывает listening");
    assert.match(hook, /wantListeningRef\.current = false;\s*restartsRef\.current = 0;\s*setListening\(false\);/, "onerror не сбрасывает состояние записи");
    assert.match(hook, /teardownRecognition\(true\)/, "повторный старт не закрывает прошлую сессию распознавания");
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
    assert.match(board, /topStrip &&/, "доска не рендерит полосу участников");
    const stripAt = board.indexOf("{topStrip &&");
    const toolbarAt = board.indexOf('role="toolbar"');
    assert.ok(stripAt > -1 && toolbarAt > -1, "не найдены полоса/тулбар в разметке доски");
    assert.ok(stripAt < toolbarAt, "полоса должна быть СВЕРХУ тулбара");
    assert.match(board.slice(stripAt, stripAt + 240), /shrink-0/, "полоса может сжаться и задвить тулбар");
  });

  it("мобильные: полоса участников в обычном потоке, а не absolute поверх сцены", () => {
    const stripAt = board.indexOf("{topStrip &&");
    const toolbarAt = board.indexOf('role="toolbar"');
    const stripBlock = board.slice(stripAt, toolbarAt);
    // Все class-литералы блока: ни один не должен позиционировать полосу абсолютно.
    const classNames = [...stripBlock.matchAll(/className="([^"]*)"/g)].map((match) => match[1]);
    assert.ok(classNames.length > 0, "у полосы нет class-атрибутов");
    for (const className of classNames) {
      assert.ok(
        !/(^|\s)absolute(\s|$)/.test(className),
        `полоса снова absolute (${className}) — она перекрывает тулбар доски`,
      );
      assert.ok(!/fixed /.test(className), `полоса зафиксирована поверх экрана (${className})`);
    }
  });

  it("десктоп: доска слева, камеры участников — правая колонка «плитка шоколада»", () => {
    assert.match(board, /fixed inset-0 z-50[^"]*md:flex-row/, "доска не разделена на две колонки на md+");
    assert.match(board, /w-60 shrink-0[^"]*md:flex lg:w-72/, "нет правой колонки камер шириной ~240–300px");
    assert.match(board, /min-h-0 w-60/, "колонка камер не ограничена по высоте (прокрутка сломается)");
    // Вертикальная прокрутка колонки живёт в Filmstrip (layout="vertical").
    assert.match(strip, /flex-col gap-2 overflow-y-auto/, "вертикальная колонка камер не прокручивается");
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

/* -------------------------------------------------------------------------- */
/* Раскладка «плитка шоколада», object-contain, мульти-pin, запись, чат       */
/* -------------------------------------------------------------------------- */

describe("раскладка при доске и демонстрации экрана: сцена + «плитка шоколада»", () => {
  const grid = readSource("src/components/meeting/VideoGrid.tsx");
  const room = readSource("src/components/meeting/MeetingRoom.tsx");
  const strip = readSource("src/components/meeting/Filmstrip.tsx");
  const mediaQuery = readSource("src/hooks/useMediaQuery.ts");

  it("десктоп: сцена слева (flex-grow), камеры — правая колонка 240–300px с прокруткой", () => {
    assert.match(room, /md:flex lg:w-72/, "в комнате нет правой колонки камер ~288px");
    assert.match(room, /w-60 shrink-0/, "колонка камер не ~240px и не предотвращает сжатие");
    assert.match(strip, /layout="vertical"|layout === "vertical"/, "полоска не умеет вертикальную раскладку");
    assert.match(strip, /flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-auto/, "колонка камер не прокручивается по вертикали");
    assert.match(mediaQuery, /min-width: 768px/, "нет SSR-безопасного определения десктопа");
    assert.match(room, /useIsDesktopLayout/, "комната не переключает раскладку по ширине");
  });

  it("мобильные: лента участников в обычном потоке, без absolute-наслоения", () => {
    // Блок мобильной ленты в MeetingRoom: от условия до закрытия.
    const stripAt = room.indexOf("screenShareActive && !boardOpen && !desktopLayout");
    assert.ok(stripAt > -1, "нет мобильной ленты при демонстрации экрана");
    const block = room.slice(stripAt, stripAt + 400);
    const classNames = [...block.matchAll(/className="([^"]*)"/g)].map((match) => match[1]);
    assert.ok(classNames.length > 0, "у мобильной ленты нет class-атрибутов");
    for (const className of classNames) {
      assert.ok(
        !/(^|\s)absolute(\s|$)/.test(className),
        `карточки участников снова absolute (${className}) — 3+ камер наслаиваются на смартфоне`,
      );
      assert.ok(!/\bfixed\b/.test(className), `мобильная лента зафиксирована поверх экрана (${className})`);
    }
    // Сетка камер строится обычным grid/flex с gap — без хардкода позиций.
    assert.match(grid, /grid h-full w-full gap-2/, "сетка камер не использует CSS Grid с gap");
  });
});

describe("демонстрация экрана вписывается целиком (object-contain)", () => {
  const grid = readSource("src/components/meeting/VideoGrid.tsx");

  it("сцена экрана: object-contain w-full h-full bg-black — края не обрезаются", () => {
    assert.match(grid, /stage \? "object-contain w-full h-full bg-black"/, "сцена экрана не вписана целиком");
    assert.match(grid, /"object-cover h-full w-full"/, "камеры участников должны заполнять плитку");
  });

  it("в записи экран тоже вписан с сохранением пропорций (letterbox)", () => {
    const recorder = readSource("src/hooks/useLessonRecorder.ts");
    assert.match(recorder, /function drawVideoContain/, "нет функции вписывания кадра в канвас");
    assert.match(
      recorder,
      /Math\.min\(box\.width \/ frameWidth, box\.height \/ frameHeight\)/,
      "кадр растягивается вместо того, чтобы вписываться — края экрана обрезаются",
    );
    assert.match(recorder, /PIP_MARGIN/, "«картинка в углу» без отступа от краёв канвы");
  });
});

describe("мульти-закрепление участников", () => {
  const grid = readSource("src/components/meeting/VideoGrid.tsx");
  const room = readSource("src/components/meeting/MeetingRoom.tsx");
  const strip = readSource("src/components/meeting/Filmstrip.tsx");

  it("состояние — массив: можно закрепить 2, 3 и более участников", () => {
    assert.match(room, /useState<string\[\]>\(\[\]\)/, "закреплённые участники не хранятся массивом");
    assert.match(room, /\.\.\.current, tileId\]/, "повторный клик не добавляет второго закреплённого");
    assert.match(room, /current\.filter\(\(id\) => id !== tileId\)/, "открепить закреплённого нельзя");
    assert.match(grid, /pinnedIds\?: readonly string\[\]/, "сетка не принимает список закреплённых");
    assert.match(strip, /pinnedIds\?: readonly string\[\]/, "полоска не принимает список закреплённых");
  });

  it("закреплённые рендерятся первыми и с визуальной рамкой", () => {
    assert.match(grid, /function orderTilesByPinned/, "нет упорядочивания плиток по закреплению");
    assert.match(grid, /pinned && "ring-2 ring-brand-400\/70"/, "у закреплённой плитки нет рамки");
    assert.match(grid, /Закреплён/, "на закреплённой плитке нет подписи");
    assert.match(strip, /orderTilesByPinned/, "полоска не выносит закреплённых вперёд");
  });

  it("«картинка в углу» записи — камера текущего спикера, а не дубль экрана", () => {
    assert.match(room, /speakerCameraTrack: recordingSpeakerTrack/, "запись не получает камеру спикера");
    assert.match(room, /pickSpotlightTile\(tiles, pinnedIds, screenTileId\)/, "спикер выбирается без закреплённых");
    // Своя плитка при демонстрации экрана показывает камеру, а не экран.
    assert.match(room, /rtc\.media\.screen \? localCameraStream : rtc\.localStream/, "в своей плитке снова дубль экрана");
    assert.match(room, /videoOn: rtc\.media\.video,/, "видео своей плитки привязано не к камере");
  });
});

describe("плашка закреплённого сообщения и открепление (unpin)", () => {
  const chat = readSource("src/components/meeting/Chat.tsx");
  const room = readSource("src/components/meeting/MeetingRoom.tsx");
  const hook = readSource("src/hooks/useSocket.ts");
  const contract = readSource("src/lib/realtime.ts");
  const server = readSource("src/server/realtime.ts");

  it("в плашке есть крестик, сбрасывающий закрепление", () => {
    assert.match(chat, /aria-label="Открепить сообщение"/, "нет кнопки-крестика в плашке");
    assert.match(chat, /onUnpinMessage/, "плашка не умеет откреплять сообщение");
    assert.match(chat, /canPinMessages/, "плашка не различает учителя и ученика");
    assert.match(room, /handleUnpinMessage/, "комната не обрабатывает открепление");
    assert.match(room, /socket\.pinMessage\(null\)/, "открепление не уходит на сервер");
  });

  it("сервер пускает к плашке только учителя/админа и шлёт событие всей комнате", () => {
    assert.match(server, /canPinChatMessage\(socket\.data\.user\.role\)/, "сервер не проверяет право закрепления");
    assert.match(server, /"pin-message"/, "сервер не принимает закрепление сообщения");
    assert.match(server, /io\.in\(roomId\)\.emit\("pinned-message", \{ pinned: null \}\)/, "открепление не рассылается комнате");
    assert.match(server, /canViewChatEnvelope\(envelope, socket\.data\.user\.id\)/, "приватное сообщение может утечь в плашку");
    assert.match(contract, /\"pin-message\"/, "контракт Socket.IO не описывает закрепление");
    assert.match(hook, /socket\.on\("pinned-message"/, "клиент не слушает изменение плашки");
    assert.match(hook, /const pinMessage = useCallback/, "хук сокета не умеет закреплять сообщение");
  });

  it("закрепившее сообщение приходит вместе с историей (перезаход видит плашку)", () => {
    assert.match(contract, /pinned: ChatEnvelope \| null;/, "join-room не отдаёт закреплённое сообщение");
    assert.match(server, /pinned: getPinnedMessage\(roomId\)/, "сервер не подставляет закреплённое сообщение");
    assert.match(hook, /setPinnedMessage\(result\.pinned \?\? null\)/, "клиент не запоминает плашку при входе");
  });
});

describe("запись урока: только экран и камера спикера", () => {
  const recorder = readSource("src/hooks/useLessonRecorder.ts");

  it("на канвас идут строго screenTrack и камера спикера — без интерфейса и других участников", () => {
    assert.match(recorder, /speakerCameraTrack\?: MediaStreamTrack \| null/, "источник записи не принимает камеру спикера");
    assert.match(recorder, /const cornerCamera = speakerCameraTrack \?\? cameraTrack;/, "в угол не попадает камера спикера");
    assert.match(recorder, /new MediaStream\(\[screenTrack\]\)/, "экран не изолирован в отдельный элемент видео");
    // Канвас — единственный источник видеотрека записи: UI в файл не попадает.
    assert.match(recorder, /canvas\.captureStream\(30\)/, "запись идёт не с канваса композиции");
  });
});

describe("регистрация без класса в гибкой школе", () => {
  const form = readSource("src/components/auth/register-form.tsx");
  const validation = readSource("src/lib/validation.ts");
  const route = readSource("src/app/api/auth/register/route.ts");
  const check = readSource("src/app/api/schools/check/route.ts");
  const schema = readSource("prisma/schema.prisma");

  it("поле класса необязательно, когда strictClassIsolation === false", () => {
    assert.match(form, /strictClassIsolation\?: boolean/, "форма не знает политику школы");
    assert.match(form, /classIsRequired = schoolCheck\?\.school\.strictClassIsolation !== false/, "нет признака обязательности класса");
    assert.match(form, /classIdOptional: !classIsRequired/, "форма не сообщает API, что класс необязателен");
    assert.match(form, /Без класса \(необязательно\)/, "в селекте нет варианта «без класса»");
    assert.match(validation, /classIdOptional\?: boolean/, "валидация не умеет необязательный класс");
    assert.match(route, /classIdOptional: !strictClassIsolation/, "роут регистрации игнорирует политику школы");
    assert.match(route, /getSchoolPolicy/, "роут не читает политику школы");
  });

  it("схема БД и API принимают classId = null", () => {
    assert.match(schema, /classId\s+String\?/, "колонка класса ученика не опциональна");
    assert.match(route, /classId: schoolClass\?\.id \?\? null/, "роут не пишет classId = null");
    assert.match(form, /classId: effectiveRole === "STUDENT" \? classId \|\| null : null/, "форма шлёт пустую строку вместо null");
  });

  it("проверка кода школы отдаёт политику изоляции классов", () => {
    assert.match(check, /strictClassIsolation: true/, "проверка школы не забирает политику из БД");
    assert.match(check, /strictClassIsolation: school\.strictClassIsolation/, "проверка школы не отдаёт политику клиенту");
  });
});

describe("мобильный Safe Area, 100dvh и PWA-манифест для сборки .apk", () => {
  const css = readSource("src/app/globals.css");
  const layout = readSource("src/app/layout.tsx");
  const appShell = readSource("src/components/layout/app-shell.tsx");
  const bottomNav = readSource("src/components/layout/bottom-nav.tsx");
  const navbar = readSource("src/components/layout/Navbar.tsx");
  const room = readSource("src/components/meeting/MeetingRoom.tsx");
  const widget = readSource("src/components/meeting/AIWidget.tsx");
  const manifestRaw = readSource("public/manifest.json");
  const sw = readSource("public/sw.js");

  it("в globals.css объявлены безопасные отступы .safe-pb и .safe-mb", () => {
    assert.match(css, /\.safe-pb\s*\{\s*padding-bottom:\s*max\(1rem,\s*env\(safe-area-inset-bottom\)\);/, "нет класса .safe-pb");
    assert.match(css, /\.safe-mb\s*\{\s*margin-bottom:\s*max\(1rem,\s*env\(safe-area-inset-bottom\)\);/, "нет класса .safe-mb");
  });

  it("контейнеры используют min-h-[100dvh] вместо min-h-screen, нижние панели защищены safe-area", () => {
    assert.match(layout, /min-h-\[100dvh\]/, "RootLayout не использует min-h-[100dvh]");
    assert.match(appShell, /min-h-\[100dvh\]/, "AppShell не использует min-h-[100dvh]");
    assert.match(room, /pb-\[calc\(1\.25rem\+env\(safe-area-inset-bottom\)\)\]|safe-pb/, "панель управления MeetingRoom не учитывает safe-area");
    assert.match(widget, /safe-mb|safe-pb|pb-\[calc\(1\.25rem\+env\(safe-area-inset-bottom\)\)\]/, "AIWidget не учитывает safe-area");
    assert.match(bottomNav, /pb-\[calc\(1\.25rem\+env\(safe-area-inset-bottom\)\)\]|safe-pb/, "BottomNav не учитывает safe-area");
    assert.match(navbar, /pb-\[calc\(1\.25rem\+env\(safe-area-inset-bottom\)\)\]|safe-pb/, "Navbar не учитывает safe-area");
  });

  it("PWA-манифест, иконки, sw.js и метатеги готовы для сборки .apk", () => {
    const manifest = JSON.parse(manifestRaw) as {
      name: string;
      short_name: string;
      description: string;
      start_url: string;
      display: string;
      background_color: string;
      theme_color: string;
      orientation: string;
      icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
    };
    assert.equal(manifest.name, "EduFlow — Образовательная платформа");
    assert.equal(manifest.short_name, "EduFlow");
    assert.equal(manifest.description, "Платформа для онлайн-уроков, ДЗ и обучения с ИИ");
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.background_color, "#0f172a");
    assert.equal(manifest.theme_color, "#0f172a");
    assert.equal(manifest.orientation, "any");
    assert.equal(manifest.icons.length, 2);
    assert.deepEqual(
      manifest.icons.map((i) => i.src),
      ["/icon-192.png", "/icon-512.png"],
    );

    const icon192 = readFileSync(join(REPO_ROOT, "public/icon-192.png"));
    const icon512 = readFileSync(join(REPO_ROOT, "public/icon-512.png"));
    assert.ok(icon192.length > 100 && icon192[0] === 0x89 && icon192[1] === 0x50, "icon-192.png не валидный PNG");
    assert.ok(icon512.length > 100 && icon512[0] === 0x89 && icon512[1] === 0x50, "icon-512.png не валидный PNG");

    assert.match(sw, /addEventListener\("install"/, "sw.js не обрабатывает install");
    assert.match(sw, /addEventListener\("fetch"/, "sw.js не обрабатывает fetch");

    assert.match(layout, /<link rel="manifest" href="\/manifest\.json"\s*\/>/, "нет ссылки на manifest.json в layout.tsx");
    assert.match(layout, /<meta name="theme-color" content="#0f172a"\s*\/>/, "нет meta theme-color #0f172a");
    assert.match(layout, /<meta name="apple-mobile-web-app-capable" content="yes"\s*\/>/, "нет apple-mobile-web-app-capable");
    assert.match(layout, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"\s*\/>/, "нет apple-mobile-web-app-status-bar-style");
  });
});

describe("кнопка установки PWA и иконки Slate & Gold", () => {
  const pwaButton = readSource("src/components/pwa-install-button.tsx");
  const navbar = readSource("src/components/layout/Navbar.tsx");
  const siteHeader = readSource("src/components/landing/site-header.tsx");

  it("перехватывает install prompt, поддерживает iOS/standalone и предлагает APK", () => {
    assert.match(pwaButton, /beforeinstallprompt/);
    assert.match(pwaButton, /useState<BeforeInstallPromptEvent \| null>/);
    assert.match(pwaButton, /await promptEvent\.prompt\(\)/);
    assert.match(pwaButton, /appinstalled/);
    assert.match(pwaButton, /display-mode: standalone/);
    assert.match(pwaButton, /Нажмите <strong[^>]*>«Поделиться»/);
    assert.match(pwaButton, /На экран &quot;Домой&quot;/);
    assert.match(pwaButton, /Скачать APK для Android/);
    assert.match(pwaButton, /href="\/eduflow\.apk"/, "кнопка APK должна ссылаться на локальный файл");
  });

  it("доступна в шапке кабинета и на гостевом лендинге", () => {
    assert.match(navbar, /<PwaInstallButton/);
    assert.match(siteHeader, /<PwaInstallButton/);
  });

  it("фирменный SVG и растровые иконки имеют нужные цвета и размеры", () => {
    const svg = readSource("public/icon.svg");
    for (const color of ["#0F172A", "#FCD34D", "#F59E0B", "#D97706"]) {
      assert.ok(svg.includes(color), `в icon.svg нет ${color}`);
    }

    for (const [file, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]] as const) {
      const png = readFileSync(join(REPO_ROOT, "public", file));
      assert.equal(png.readUInt32BE(16), size, `${file}: неверная ширина`);
      assert.equal(png.readUInt32BE(20), size, `${file}: неверная высота`);
    }

    const favicon = readFileSync(join(REPO_ROOT, "public/favicon.ico"));
    assert.equal(favicon.readUInt16LE(2), 1, "favicon.ico имеет неверный тип ресурса");
    assert.equal(favicon.readUInt16LE(4), 3, "favicon.ico должен содержать 16/32/48 px");
    assert.match(readSource("scripts/generate-icons.ts"), /sharp/);
    assert.match(readSource("package.json"), /"icons:generate"/);
  });
});

/* -------------------------------------------------------------------------- */
/* APK: фиксированный локальный путь /eduflow.apk                             */
/* -------------------------------------------------------------------------- */

describe("раздача APK по фиксированному пути /eduflow.apk", () => {
  const installBlock = readSource("src/components/landing/install-block.tsx");
  const pwaButton = readSource("src/components/pwa-install-button.tsx");
  const hook = readSource("src/hooks/usePwaInstall.ts");

  it("обе кнопки «Скачать APK» ссылаются строго на /eduflow.apk и содержат download", () => {
    for (const [name, source] of [
      ["install-block.tsx", installBlock],
      ["pwa-install-button.tsx", pwaButton],
    ] as const) {
      assert.match(source, /href="\/eduflow\.apk"/, `${name}: ссылка должна быть строго /eduflow.apk`);
      assert.match(source, /download="EduFlow\.apk"/, `${name}: нет атрибута download="EduFlow.apk"`);
      assert.doesNotMatch(
        source,
        /href=\{apkUrl\}|NEXT_PUBLIC_APK_DOWNLOAD_URL/,
        `${name}: путь к APK не должен переопределяться`,
      );
    }
    assert.match(hook, /APK_DOWNLOAD_URL\s*=\s*"\/eduflow\.apk"/, "хук фиксирует локальный путь");
    assert.doesNotMatch(hook, /process\.env\.NEXT_PUBLIC_APK_DOWNLOAD_URL/, "хук не читает URL из env");
  });

  it("public/eduflow.apk существует, это валидный ZIP/APK и нет дубля в другом регистре", () => {
    const apk = readFileSync(join(REPO_ROOT, "public/eduflow.apk"));
    assert.equal(apk.subarray(0, 4).toString("hex"), "504b0304", "public/eduflow.apk не является ZIP/APK");
    assert.ok(apk.includes("AndroidManifest.xml"), "в APK нет AndroidManifest.xml");
    assert.ok(apk.includes("classes.dex"), "в APK нет classes.dex");
    assert.equal(
      existsSync(join(REPO_ROOT, "public/Eduflow.apk")),
      false,
      "файл с заглавной буквы ломает скачивание на регистрозависимых ФС (Linux/Vercel)",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Дистрибуция: APK для Android, MSIX для Windows, Safari для Mac / iPhone     */
/* -------------------------------------------------------------------------- */

type SwFetchEvent = {
  request: { method: string; url: string };
  respondWith: (response: unknown) => void;
};

/**
 * Прогоняет `public/sw.js` в песочнице и сообщает, перехватил ли SW запрос.
 *
 * Событие `fetch` вызывается вручную: так проверяется реальное поведение SW
 * (ранний `return` без `respondWith`), а не наличие строк в исходнике.
 */
function serviceWorkerIntercepts(source: string, pathname: string, method = "GET"): boolean {
  const listeners = new Map<string, Array<(event: SwFetchEvent) => void>>();

  const selfStub = {
    location: { origin: "https://eduflow.test" },
    addEventListener: (type: string, handler: (event: SwFetchEvent) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    skipWaiting: () => undefined,
    clients: { claim: () => undefined },
  };
  const cachesStub = {
    open: async () => ({ addAll: async () => undefined }),
    keys: async () => [],
    delete: async () => true,
    match: async () => undefined,
  };
  const fetchStub = async () => new Response(null, { status: 200 });

  new Function("self", "caches", "fetch", source)(selfStub, cachesStub, fetchStub);

  const fetchHandlers = listeners.get("fetch");
  assert.ok(fetchHandlers && fetchHandlers.length > 0, "sw.js не подписан на событие fetch");

  let intercepted = false;
  const event: SwFetchEvent = {
    request: { method, url: `https://eduflow.test${pathname}` },
    respondWith: () => {
      intercepted = true;
    },
  };
  for (const handler of fetchHandlers) handler(event);
  return intercepted;
}

describe("дистрибуция установщиков: APK, Electron-установщик для Windows и Mac / iPhone", () => {
  const installBlock = readSource("src/components/landing/install-block.tsx");
  const sw = readSource("public/sw.js");

  it("три кнопки: Android (.apk), Windows (.exe Установщик) и Mac / iPhone", () => {
    assert.match(installBlock, /🤖 Скачать APK для Android/, "нет кнопки для Android");
    assert.match(
      installBlock,
      /💻 Скачать для Windows \(\.exe Установщик\)/,
      "нет кнопки Windows с полноценным .exe-установщиком",
    );
    assert.match(installBlock, /🍏 Скачать для Mac \(\.dmg\)/, "нет кнопки для Mac / iPhone");
    assert.doesNotMatch(
      installBlock,
      /\/ portable|\.exe \/ portable/,
      "осталась подпись портативной версии — нужен полноценный .exe-установщик",
    );
  });

  it("ссылки ведут строго на локальные /eduflow.apk и /eduflow-setup.exe с атрибутом download", () => {
    assert.match(
      installBlock,
      /href="\/eduflow\.apk"[\s\S]{0,120}?download="EduFlow\.apk"/,
      'кнопка Android должна скачивать /eduflow.apk с download="EduFlow.apk"',
    );
    assert.match(
      installBlock,
      /href="\/eduflow-setup\.exe"[\s\S]{0,120}?download="EduFlow-Setup\.exe"/,
      'кнопка Windows должна скачивать /eduflow-setup.exe с download="EduFlow-Setup.exe"',
    );
    assert.doesNotMatch(installBlock, /eduflow-windows\.zip/, "осталась ссылка на ZIP-архив");
    assert.doesNotMatch(installBlock, /href="\/eduflow\.msix"/, "прямая ссылка на MSIX снова появилась");
    assert.doesNotMatch(installBlock, /href="https?:[^"]*eduflow-setup\.exe"/, "ссылка должна быть локальной");
  });

  it("кнопка Mac / iPhone открывает инструкцию для Safari через общий <Modal>", () => {
    assert.match(
      installBlock,
      /import \{ Modal \} from "@\/components\/ui\/modal"/,
      "инструкция должна использовать общий каркас <Modal>",
    );
    assert.match(installBlock, /<Modal\b/, "модалка инструкции не рендерится");
    assert.match(
      installBlock,
      /onClick=\{\(\) => setIsAppleHelpOpen\(true\)\}/,
      "кнопка Mac / iPhone не открывает инструкцию",
    );
    assert.match(installBlock, /«Поделиться»/, "в инструкции нет шага «Поделиться»");
    assert.match(installBlock, /На экран &quot;Домой&quot;/, "в инструкции нет шага «На экран Домой»");
    assert.match(installBlock, /«Добавить»/, "в инструкции нет шага «Добавить»");
  });

  it("SW отдаёт тяжёлый .exe напрямую: без кеша и без подмены закэшированным HTML", () => {
    assert.match(sw, /BINARY_DOWNLOAD_EXTENSIONS/, "в sw.js нет списка исключений");
    assert.match(
      sw,
      /BINARY_DOWNLOAD_EXTENSIONS\s*=\s*\[[^\]]*"\.exe"/,
      "в BINARY_DOWNLOAD_EXTENSIONS нет .exe — установщик подменится HTML-страницей",
    );
    assert.match(sw, /"\.apk"/, "в исключениях SW нет .apk");
    assert.match(sw, /"\.dmg"/, "в исключениях SW нет .dmg");

    for (const path of ["/eduflow-setup.exe", "/EduFlow-Setup.EXE", "/eduflow-setup.exe?v=2"]) {
      assert.equal(serviceWorkerIntercepts(sw, path), false, `SW перехватывает ${path}`);
    }
    assert.equal(serviceWorkerIntercepts(sw, "/eduflow.apk"), false, "SW перехватывает APK");

    // Остальной трафик SW по-прежнему кэширует, а не-GET запросы пропускает.
    assert.equal(serviceWorkerIntercepts(sw, "/dashboard"), true, "SW перестал обслуживать страницы");
    assert.equal(serviceWorkerIntercepts(sw, "/eduflow-setup.exe", "POST"), false, "SW вмешивается в POST");
  });
});

/* -------------------------------------------------------------------------- */
/* Полноценный Electron-установщик для Windows: public/eduflow-setup.exe      */
/* -------------------------------------------------------------------------- */

describe("полноценный установщик EduFlow для Windows (Electron)", () => {
  /** Полноценный Electron-инсталлятор весит десятки мегабайт, а не десятки килобайт. */
  const MIN_SIZE_MB = 60;
  const MAX_SIZE_MB = 130;

  it("public/eduflow-setup.exe — настоящий NSIS-установщик на десятки мегабайт", () => {
    const exePath = join(REPO_ROOT, "public/eduflow-setup.exe");
    assert.ok(existsSync(exePath), "нет public/eduflow-setup.exe — кнопка Windows приведёт на 404");

    const exe = readFileSync(exePath);
    assert.equal(exe.subarray(0, 2).toString("ascii"), "MZ", "это не Windows-исполняемый файл");

    const peOffset = exe.readUInt32LE(0x3c);
    assert.equal(exe.toString("ascii", peOffset, peOffset + 4), "PE\0\0", "нет PE-заголовка");
    assert.ok(
      exe.includes(Buffer.from("NullsoftInst", "ascii")),
      "это не NSIS-установщик — пользователь не сможет установить приложение",
    );

    const sizeMb = exe.length / (1024 * 1024);
    assert.ok(
      sizeMb >= MIN_SIZE_MB,
      `установщик весит ${sizeMb.toFixed(1)} МБ — это микро-скрипт, а не Electron (ожидалось ≥ ${MIN_SIZE_MB} МБ)`,
    );
    assert.ok(sizeMb <= MAX_SIZE_MB, `установщик разросся до ${sizeMb.toFixed(1)} МБ`);
  });

  it("микро-архивы и MSIX удалены из public/", () => {
    for (const file of [
      "eduflow-windows.zip",
      "Eduflow-windows.zip",
      "eduflow.msix",
      "Eduflow.msix",
      "eduflow-portable.exe",
    ]) {
      assert.equal(
        existsSync(join(REPO_ROOT, "public", file)),
        false,
        `public/${file} должен быть удалён — Windows-версия теперь только .exe-установщик`,
      );
    }
  });

  it("репозиторий больше не ссылается на eduflow-windows.zip и eduflow.msix", () => {
    const sources = [
      "src/components/landing/install-block.tsx",
      "src/components/pwa-install-button.tsx",
      "src/lib/install-copy.ts",
      "public/sw.js",
      "scripts/build-windows-installer.ts",
      "desktop/main.js",
      "package.json",
    ];
    for (const file of sources) {
      const source = readSource(file);
      assert.doesNotMatch(source, /eduflow-windows\.zip/, `${file}: осталась ссылка на ZIP-архив`);
      assert.doesNotMatch(source, /eduflow\.msix/, `${file}: осталась ссылка на MSIX`);
    }
    assert.equal(
      existsSync(join(REPO_ROOT, "windows-portable")),
      false,
      "каталог windows-portable с микро-лаунчером должен быть удалён",
    );
  });

  it("модальное окно установки объясняет установку .exe простыми шагами", () => {
    const copy = readSource("src/lib/install-copy.ts");
    assert.match(copy, /SmartScreen/, "в текстах установки нет пояснения про SmartScreen");
    assert.match(copy, /EduFlow-Setup\.exe/, "в текстах установки нет имени установщика");

    for (const name of [
      "src/components/landing/install-block.tsx",
      "src/components/pwa-install-button.tsx",
    ]) {
      const source = readSource(name);
      assert.match(source, /WINDOWS_SMARTSCREEN_NOTE/, `${name}: в модалке нет текста про SmartScreen`);
      assert.match(source, /href="\/eduflow-setup\.exe"/, `${name}: нет ссылки на .exe-установщик`);
      assert.match(source, /download="EduFlow-Setup\.exe"/, `${name}: у ссылки нет download="EduFlow-Setup.exe"`);
    }

    // Понятная пошаговая инструкция: скачать → открыть → SmartScreen → «Установить» → ярлык.
    const steps = readSource("src/components/landing/install-block.tsx");
    for (const phrase of [
      /windows-install-title/,
      /EduFlow-Setup\.exe/,
      /«Подробнее»/,
      /«Установить»/,
      /рабочем столе/,
      /меню «Пуск»/,
    ]) {
      assert.match(steps, phrase, `в инструкции для Windows нет шага ${phrase}`);
    }
  });

  it("сборка воспроизводима: electron-builder, NSIS, окно Electron и workflow", () => {
    const builder = readSource("electron-builder.yml");
    assert.match(builder, /productName: EduFlow/, "нет имени приложения в конфиге сборщика");
    assert.match(builder, /target: nsis/, "Windows-цель должна быть NSIS-установщиком");
    assert.match(builder, /app: desktop/, "electron-builder должен собирать оболочку desktop/");
    assert.match(builder, /artifactName: eduflow-setup\.\$\{ext\}/, "имя артефакта не eduflow-setup.exe");
    assert.match(builder, /compression: maximum/, "нет максимального сжатия — установщик раздуется");

    const main = readSource("desktop/main.js");
    assert.match(main, /schoolmeet-vb96\.onrender\.com/, "приложение не открывает платформу EduFlow");
    assert.match(main, /new BrowserWindow\(/, "нет окна приложения");
    assert.match(main, /loadURL\(APP_URL\)/, "приложение не загружает платформу при старте");
    assert.match(main, /contextIsolation: true/, "контекст страницы не изолирован");
    assert.match(main, /nodeIntegration: false/, "Node.js доступен веб-странице");
    assert.match(main, /requestSingleInstanceLock/, "нет защиты от второго экземпляра приложения");
    assert.match(main, /setPermissionRequestHandler/, "нет выдачи разрешений камеры и микрофона");
    assert.match(readSource("desktop/preload.js"), /contextBridge\.exposeInMainWorld/, "нет preload-моста");

    const build = readSource("scripts/build-windows-installer.ts");
    assert.match(build, /public\/eduflow-setup\.exe/, "результат сборки — public/eduflow-setup.exe");
    assert.match(build, /electron-builder/, "сборка идёт через electron-builder");
    assert.match(build, /NullsoftInst/, "сборка проверяет NSIS-загрузчик");
    assert.match(build, /icon\.ico/, "иконка №9 не передаётся в установщик");

    const packageJson = JSON.parse(readSource("package.json")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    assert.equal(
      packageJson.scripts["build:windows"],
      "tsx scripts/build-windows-installer.ts",
      "скрипт build:windows должен собирать .exe-установщик",
    );
    assert.ok(packageJson.devDependencies.electron, "electron не в devDependencies");
    assert.ok(packageJson.devDependencies["electron-builder"], "electron-builder не в devDependencies");
    assert.match(readSource(".gitignore"), /\/dist/, "артефакты electron-builder не должны попадать в git");

    const workflow = readSource(".github/workflows/build-windows-installer.yml");
    assert.match(workflow, /runs-on: windows-latest/, "установщик собирается на Windows-раннере");
    assert.match(workflow, /npm run build:windows/, "workflow не собирает установщик");
    assert.match(workflow, /contents: write/, "workflow не сможет закоммитить установщик");
  });

  it("иконка №9 (public/icon.svg) — источник favicon.ico в окне браузера", async () => {
    const svg = readFileSync(join(REPO_ROOT, "public/icon.svg"));
    assert.ok(svg.includes(Buffer.from("Option #9")), "public/icon.svg больше не описывает дизайн №9");

    const expected = await renderIco(svg, [16, 32, 48]);
    assert.ok(
      readFileSync(join(REPO_ROOT, "public/favicon.ico")).equals(expected),
      "favicon.ico устарел — запустите npm run icons:generate",
    );

    const layout = readSource("src/app/layout.tsx");
    assert.match(layout, /href="\/favicon\.ico"/, "окно приложения не получает favicon");
    assert.match(layout, /href="\/icon\.svg"/, "нет векторной иконки приложения");
    assert.ok(
      existsSync(join(REPO_ROOT, "desktop/assets/icon.png")),
      "нет иконки окна Electron (desktop/assets/icon.png)",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Все 3 варианта установки сразу: без авто-детекции ОС                        */
/* -------------------------------------------------------------------------- */

describe("установка без авто-детекции ОС: все 3 варианта видны сразу", () => {
  const pwaButton = readSource("src/components/pwa-install-button.tsx");
  const installBlock = readSource("src/components/landing/install-block.tsx");
  const hook = readSource("src/hooks/usePwaInstall.ts");

  it("компоненты и хук больше не фильтруют устройства по строке браузера", () => {
    for (const [name, source] of [
      ["pwa-install-button.tsx", pwaButton],
      ["install-block.tsx", installBlock],
      ["usePwaInstall.ts", hook],
    ] as const) {
      assert.doesNotMatch(
        source,
        /userAgent/,
        `${name}: авто-детекция ОС по строке браузера должна быть убрана`,
      );
      assert.doesNotMatch(
        source,
        /isIOS|isWindows/,
        `${name}: остатки фильтрации устройств должны быть убраны`,
      );
    }
  });

  it("модалка установки показывает все 3 кнопки списком, а не только Android", () => {
    assert.match(pwaButton, /Скачать APK для Android/, "в модалке нет кнопки Android");
    assert.match(
      pwaButton,
      /Скачать для Windows \(\.exe Установщик\)/,
      "в модалке нет кнопки .exe-установщика для Windows",
    );
    assert.match(pwaButton, /Скачать для Mac \(\.dmg\)/, "в модалке нет кнопки Mac / iPhone");
    assert.match(
      pwaButton,
      /href="\/eduflow-setup\.exe"[^>]*download="EduFlow-Setup\.exe"/,
      "кнопка Windows должна ссылаться на /eduflow-setup.exe с download",
    );
    assert.match(
      pwaButton,
      /onClick=\{\(\) => setShowAppleHelp\(true\)\}/,
      "кнопка Mac / iPhone не открывает пошаговую подсказку",
    );
  });

  it("главная страница и модалка используют одинаковые три варианта", () => {
    for (const [name, source] of [
      ["install-block.tsx", installBlock],
      ["pwa-install-button.tsx", pwaButton],
    ] as const) {
      assert.match(source, /Скачать APK для Android/, `${name}: нет варианта Android`);
      assert.match(
        source,
        /Скачать для Windows \(\.exe Установщик\)/,
        `${name}: нет варианта .exe-установщика для Windows`,
      );
      assert.match(source, /Скачать для Mac \(\.dmg\)/, `${name}: нет варианта Mac / iPhone`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Ребрендинг: платформа называется EduFlow                                    */
/* -------------------------------------------------------------------------- */

describe("ребрендинг платформы EduFlow", () => {
  const layout = readSource("src/app/layout.tsx");
  const manifestRaw = readSource("public/manifest.json");
  const packageRaw = readSource("package.json");

  /** Экраны и карточки, где раньше встречался старый бренд SchoolMeet. */
  const BRAND_SOURCES = [
    "src/components/layout/Navbar.tsx",
    "src/components/layout/app-shell.tsx",
    "src/components/layout/bottom-nav.tsx",
    "src/components/landing/logo.tsx",
    "src/components/landing/site-header.tsx",
    "src/components/landing/site-footer.tsx",
    "src/components/landing/hero.tsx",
    "src/components/auth/auth-shell.tsx",
    "src/app/login/page.tsx",
    "src/app/auth/register/page.tsx",
    "src/app/dashboard/page.tsx",
    "src/components/meeting/AIAssistant.tsx",
    "src/components/meeting/MeetingRoom.tsx",
  ] as const;

  it("SEO-метаданные, OpenGraph, Twitter и PWA-заголовки используют EduFlow", () => {
    assert.match(
      layout,
      /default: "EduFlow — Интерактивная образовательная платформа с ИИ"/,
      "нет нового title приложения",
    );
    assert.match(layout, /template: "%s · EduFlow"/, "шаблон title не обновлён");
    assert.match(
      layout,
      /Онлайн-уроки, виртуальная доска, умные ДЗ и ИИ-помощник нового поколения/,
      "нет нового description приложения",
    );
    assert.match(layout, /openGraph:\s*\{[\s\S]*title: "EduFlow/, "openGraph.title не обновлён");
    assert.match(layout, /twitter:\s*\{[\s\S]*title: "EduFlow/, "twitter.title не обновлён");
    assert.match(layout, /siteName: "EduFlow"/, "openGraph.siteName не обновлён");
    assert.match(layout, /applicationName: "EduFlow"/, "application-name не обновлён");
    assert.match(layout, /<meta name="application-name" content="EduFlow"\s*\/>/, "нет PWA-метатега с EduFlow");
    assert.ok(!layout.includes("SchoolMeet"), "в метаданных остался старый бренд");

    const manifest = JSON.parse(manifestRaw) as {
      name: string;
      short_name: string;
      description: string;
    };
    assert.equal(manifest.name, "EduFlow — Образовательная платформа");
    assert.equal(manifest.short_name, "EduFlow");
    assert.equal(manifest.description, "Платформа для онлайн-уроков, ДЗ и обучения с ИИ");
  });

  it("имя проекта в package.json обновлено на eduflow", () => {
    assert.equal((JSON.parse(packageRaw) as { name: string }).name, "eduflow");
  });

  it("во всех экранах используется EduFlow и нет старого бренда", () => {
    for (const file of BRAND_SOURCES) {
      const source = readSource(file);
      assert.ok(source.includes("EduFlow"), `${file}: нет бренда EduFlow`);
      assert.ok(!source.includes("SchoolMeet"), `${file}: остался старый бренд SchoolMeet`);
    }
  });

  it("fallback-имя бренда, приветствие и копирайт обновлены", () => {
    for (const file of [
      "src/components/layout/Navbar.tsx",
      "src/components/layout/app-shell.tsx",
      "src/components/landing/logo.tsx",
      "src/components/landing/site-footer.tsx",
      "src/components/landing/site-header.tsx",
      "src/app/auth/register/page.tsx",
      "src/app/dashboard/page.tsx",
    ]) {
      assert.match(readSource(file), /\|\| "EduFlow"/, `${file}: fallback бренда не EduFlow`);
    }
    assert.match(readSource("src/app/login/page.tsx"), /Добро пожаловать в EduFlow/, "нет приветствия EduFlow");
    assert.match(
      readSource("src/components/landing/site-footer.tsx"),
      /© 2024 EduFlow\. Сделано с любовью для/,
      "копирайт футера не обновлён",
    );
    assert.match(
      readSource("src/components/landing/site-footer.tsx"),
      /Лицея Сингулярити/,
      "в копирайте футера нет Лицея Сингулярити",
    );
  });
});


/* -------------------------------------------------------------------------- */
/* Главный экран: премиальная Hero-секция                                     */
/* -------------------------------------------------------------------------- */

describe("Hero-секция главной страницы", () => {
  const hero = readSource("src/components/landing/hero.tsx");
  const installBlock = readSource("src/components/landing/install-block.tsx");

  it("H1 и подзаголовок несут новые тексты", () => {
    assert.match(hero, /EduFlow — Образование будущего/, "в H1 нет нового заголовка");
    assert.match(hero, /с ИИ/, "в H1 нет акцентного «с ИИ»");
    assert.match(
      hero,
      /Интерактивный холст, умные ИИ-ассистенты и видеосвязь в одном приложении\./,
      "нет нового подзаголовка",
    );
    assert.match(hero, /Учитесь\s+вместе, идите дальше\./, "подзаголовок обрезан");
  });

  it("блок установки идёт прямо под подзаголовком и до кнопок-призывов", () => {
    const subtitleAt = hero.indexOf("Интерактивный холст");
    const installAt = hero.indexOf("<InstallBlock />");
    const ctaAt = hero.indexOf("Начать урок");

    assert.ok(subtitleAt > -1, "нет подзаголовка");
    assert.ok(installAt > subtitleAt, "InstallBlock не под подзаголовком");
    assert.ok(ctaAt > installAt, "кнопки «Начать урок» стоят выше блока установки");
  });

  it("фон секции — градиент из глубокого тёмно-синего в чёрный", () => {
    assert.match(hero, /linear-gradient\(180deg,#0A1B3D[_ ]0%/, "нет тёмно-синего старта градиента");
    assert.match(hero, /#000000[_ ]100%/, "градиент не уходит в чёрный");
    assert.match(hero, /rgba\(245,158,11/, "нет золотого свечения под иконки и кнопки");
  });

  it("InstallBlock центрирован и оформлен в едином дизайне №9", () => {
    assert.match(installBlock, /mx-auto[^"]*max-w-2xl/, "блок установки не отцентрирован");
    assert.match(installBlock, /bg-\[#0F172A\]/, "нет тёмно-сланцевого фона панели");
    assert.match(installBlock, /border-white\/10/, "нет белой окантовки панели");
    assert.match(installBlock, /text-amber-400/, "нет золотых иконок");
  });
});

/* Real Mac download: no HTML placeholders or signature-only dummy files. */
describe("macOS DMG download", () => {
  it("both components expose all three direct download anchors", () => {
    const targets = [
      { file: "eduflow.apk", download: "EduFlow.apk", label: "🤖 Скачать APK для Android" },
      {
        file: "eduflow-setup.exe",
        download: "EduFlow-Setup.exe",
        label: "💻 Скачать для Windows (.exe Установщик)",
      },
      { file: "eduflow.dmg", download: "EduFlow.dmg", label: "🍏 Скачать для Mac (.dmg)" },
    ];

    for (const path of ["src/components/landing/install-block.tsx", "src/components/pwa-install-button.tsx"]) {
      const source = readSource(path).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const target of targets) {
        const anchor = source.match(
          new RegExp(`<a\\s+href="/${target.file.replace(/\./g, "\\.")}"[^>]*>[\\s\\S]*?</a>`),
        );
        assert.ok(anchor, `${path}: missing ${target.file} anchor`);
        assert.ok(anchor[0].includes(`download="${target.download}"`), `${path}: ${target.file} без download`);
        assert.doesNotMatch(anchor[0], /onClick=|disabled=/);
        assert.ok(anchor[0].includes(target.label), `${path}: ${target.file} без подписи «${target.label}»`);
      }
    }
  });

  it("contains a complete UDIF v4 trailer, zlib block map and mountable filesystem payload", () => {
    const dmg = readFileSync(join(REPO_ROOT, "public/eduflow.dmg"));
    const trailer = dmg.subarray(-512);
    assert.equal(trailer.toString("ascii", 0, 4), "koly");
    assert.equal(trailer.readUInt32BE(4), 4);
    assert.equal(trailer.readUInt32BE(8), 512);
    const xmlOffset = Number(trailer.readBigUInt64BE(216));
    const xmlLength = Number(trailer.readBigUInt64BE(224));
    assert.equal(xmlOffset + xmlLength + 512, dmg.length);
    assert.equal(Number(trailer.readBigUInt64BE(32)), xmlOffset);
    const xml = dmg.toString("utf8", xmlOffset, xmlOffset + xmlLength);
    const data = xml.match(/<data>([\s\S]*?)<\/data>/);
    assert.ok(data, "missing blkx data");
    const blkx = Buffer.from(data[1].replace(/\s/g, ""), "base64");
    assert.equal(blkx.toString("ascii", 0, 4), "mish");
    assert.equal(blkx.readUInt32BE(200), 2);
    assert.equal(blkx.readUInt32BE(204), 0x80000005, "must be a UDZO zlib run");
    assert.equal(blkx.readUInt32BE(244), 0xffffffff);
    const raw = inflateSync(dmg.subarray(0, xmlOffset));
    assert.equal(raw.length, Number(trailer.readBigUInt64BE(492)) * 512);
    assert.equal(raw.toString("ascii", 1024, 1026), "H+", "must contain HFS+, not ISO9660");
    assert.equal(raw.readUInt16BE(1026), 4, "HFS+ volume version");
    assert.equal(raw.toString("ascii", raw.length - 1024, raw.length - 1022), "H+", "backup volume header");
    assert.ok(raw.includes(Buffer.from("CFBundleExecutable")));
    assert.ok(raw.includes(Buffer.from('#!/bin/sh\nexec /usr/bin/open "https://schoolmeet-vb96.onrender.com"\n')));
    assert.ok(raw.includes(Buffer.from("CFBundleIconFile")));
    assert.ok(raw.includes(Buffer.from("EduFlow.icns")));
    const iconAt = raw.indexOf(Buffer.from("icns"));
    assert.ok(iconAt >= 0, "missing ICNS icon");
    assert.equal(raw.toString("ascii", iconAt + 8, iconAt + 12), "ic09");
    assert.ok(raw.includes(readFileSync(join(REPO_ROOT, "public/icon-512.png"))));
    assert.ok(raw.includes(Buffer.from("EduFlow.app", "utf16le").swap16()), "missing HFS+ bundle catalog entry");
    assert.ok(!raw.includes(Buffer.from("display dialog")), "must open the site without asking for a URL");
    assert.ok(raw.includes(Buffer.from("NOT a native")), "payload must disclose launcher limitations");
  });

  it("macOS CI builds and verifies HFS+/UDZO and publishes only main pushes", () => {
    const workflow = readSource(".github/workflows/build-mac-dmg.yml");
    const generator = readSource("scripts/create-mac-dmg.py");
    assert.match(workflow, /push:\s*branches: \[main\]/);
    assert.match(workflow, /runs-on: macos-latest/);
    assert.match(workflow, /hdiutil verify public\/eduflow\.dmg/);
    assert.match(workflow, /hdiutil attach -readonly/);
    assert.match(workflow, /actions\/upload-artifact@v4/);
    assert.match(workflow, /github.event_name == 'push' && github.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /gh release upload macos-latest/);
    assert.match(generator, /'-fs', 'HFS\+'/);
    assert.match(generator, /'-format', 'UDZO'/);
    assert.match(generator, /run\('hdiutil', 'verify'/);
    assert.doesNotMatch(workflow, /npm run build|prisma generate|pull_request_target/);
  });

  it("SW bypasses DMG downloads online and offline, including uppercase extensions and queries", () => {
    const sw = readSource("public/sw.js");
    assert.match(sw, /BINARY_DOWNLOAD_EXTENSIONS\s*=\s*\[[^\]]*"\.dmg"/);
    for (const path of ["/eduflow.dmg", "/EduFlow.DMG", "/eduflow.dmg?v=2"]) {
      assert.equal(serviceWorkerIntercepts(sw, path), false);
    }
    assert.equal(serviceWorkerIntercepts(sw, "/dashboard"), true);
  });
});

/* -------------------------------------------------------------------------- */
/* Десктопный интерфейс Windows: без верхнего меню и кнопок установки в окне  */
/* -------------------------------------------------------------------------- */

describe("десктопный интерфейс Windows без верхнего меню Electron и кнопок установки", () => {
  const main = readSource("desktop/main.js");
  const isAppHook = readSource("src/hooks/useIsApp.ts");
  const installBlock = readSource("src/components/landing/install-block.tsx");
  const pwaButton = readSource("src/components/pwa-install-button.tsx");

  it("desktop/main.js полностью вырезает верхнее меню Electron и ставит метку EduFlowDesktop/1.0.0", () => {
    const menuNullMatches = main.match(/Menu\.setApplicationMenu\(null\);/g) ?? [];
    assert.ok(
      menuNullMatches.length >= 2,
      "Menu.setApplicationMenu(null) должен вызываться и перед созданием окна, и в app.whenReady",
    );
    assert.doesNotMatch(main, /Menu\.buildFromTemplate|function buildMenu/, "остался шаблон верхнего меню");
    assert.doesNotMatch(main, /autoHideMenuBar:\s*false/, "autoHideMenuBar снова выключен");
    assert.doesNotMatch(main, /setMenuBarVisibility\(true\)/, "полоса меню снова принудительно включена");

    assert.match(main, /autoHideMenuBar:\s*true/, "в new BrowserWindow нет autoHideMenuBar: true");
    assert.match(main, /menuBarVisible:\s*false/, "в new BrowserWindow нет menuBarVisible: false");
    assert.match(
      main,
      /webContents\.setUserAgent\(webContents\.getUserAgent\(\)\s*\+\s*["'] EduFlowDesktop\/1\.0\.0["']\)/,
      "нет метки EduFlowDesktop/1.0.0 в User-Agent окна",
    );
    assert.doesNotMatch(
      main,
      /const window = createMainWindow\(\);\s*window\.webContents\.setUserAgent\(BROWSER_USER_AGENT\)/,
      "User-Agent перезатирается после createMainWindow и теряет метку EduFlowDesktop/1.0.0",
    );
  });

  it("хук useIsApp определяет Electron (EduFlowDesktop) и standalone PWA без поломки гидрации", () => {
    assert.match(isAppHook, /"use client";/, "хук должен быть клиентским модулем");
    assert.match(isAppHook, /useState\(false\)/, "первый рендер должен возвращать false для SSR-гидрации");
    assert.match(
      isAppHook,
      /navigator\.userAgent\.includes\(["']EduFlowDesktop["']\)/,
      "useIsApp не проверяет метку EduFlowDesktop в navigator.userAgent",
    );
    assert.match(
      isAppHook,
      /window\.matchMedia\(["']\(display-mode: standalone\)["']\)\.matches/,
      "useIsApp не проверяет display-mode: standalone",
    );
  });

  it("оба блока установки скрываются внутри приложения (useIsApp)", () => {
    for (const [name, source] of [
      ["install-block.tsx", installBlock],
      ["pwa-install-button.tsx", pwaButton],
    ] as const) {
      assert.match(source, /import \{ useIsApp \} from "@\/hooks\/useIsApp"/, `${name}: не подключён useIsApp`);
      assert.match(source, /const isApp = useIsApp\(\);/, `${name}: не вызывается useIsApp()`);
    }
    assert.match(installBlock, /if \(isApp\) return null;/, "InstallBlock не скрывается внутри приложения");
    assert.match(
      pwaButton,
      /if \(isApp \|\| isInstalled\) return null;|if \(isInstalled \|\| isApp\) return null;/,
      "PwaInstallButton не скрывается внутри приложения",
    );
  });
});

