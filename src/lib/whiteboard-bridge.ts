/**
 * Двусторонний мост «ИИ ↔ интерактивная доска» Лицея Сингулярити.
 *
 * ЗАЧЕМ: доска (`Whiteboard.tsx` + `useWhiteboard`) и ИИ-виджет (`AIWidget` /
 * `AIAssistant`) живут в разных ветках дерева урока, а доска ещё и монтируется
 * только когда открыта. Прямые пропсы через страницу урока хрупки: виджет не
 * знает, открыта ли доска прямо сейчас, и молча терял чертежи ИИ.
 *
 * Этот модуль — единый реестр моста (singleton + подписки для React):
 *  - доска при монтировании регистрирует себя: `registerWhiteboardBridge(...)`;
 *  - `getCanvasSnapshot()` — текущий снимок доски в base64 PNG
 *    (`canvas.toDataURL('image/png')` под капотом Fabric.js) для Vision-анализа;
 *  - `drawCommand(command)` — выполнить команду рисования ИИ на открытой доске.
 *    Принимает ОБА формата: структурированные `DrawingInstruction[]` движка
 *    черчения и компактную JSON-команду вида
 *    `{"action":"draw","shapes":[{"type":"triangle","x":100,"y":100,"size":80,"color":"#ef4444"}]}`.
 *  - `extractDrawCommand(text)` — перехватывает такую JSON-команду прямо в
 *    текстовом ответе модели (в т.ч. в блоке ```json) и вырезает её из текста.
 *
 * Модуль чистый: ни DOM, ни Fabric.js — только `import type` контракта ИИ.
 * Поэтому его безопасно импортировать и на клиенте, и на сервере (парсеры
 * ответов провайдеров используют те же конвертеры фигур).
 */

import type { DrawingInstruction } from "./ai-providers/types";

/* -------------------------------------------------------------------------- */
/* Реестр моста                                                                */
/* -------------------------------------------------------------------------- */

/** Что открытая доска умеет делать для ИИ-виджета. */
export interface WhiteboardBridge {
  /** PNG-снимок текущей страницы доски (data URL) или `null`, если канва не готова. */
  captureBoard: (maxWidth?: number) => string | null;
  /** Нарисовать фигуры из инструкций ИИ на текущей странице доски. */
  applyDrawing: (instructions: DrawingInstruction[]) => void;
}

type BridgeListener = () => void;

let currentBridge: WhiteboardBridge | null = null;
const listeners = new Set<BridgeListener>();

function notifyBridgeListeners(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Подписчик не должен ронять реестр моста.
    }
  });
}

/**
 * Регистрирует открытую доску в мосте. Возвращает функцию снятия регистрации —
 * её доска вызывает при размонтировании.
 */
export function registerWhiteboardBridge(bridge: WhiteboardBridge): () => void {
  currentBridge = bridge;
  notifyBridgeListeners();
  return () => unregisterWhiteboardBridge(bridge);
}

/** Снимает регистрацию доски (только если зарегистрирована именно она). */
export function unregisterWhiteboardBridge(bridge?: WhiteboardBridge): void {
  if (bridge && currentBridge !== bridge) return;
  if (!currentBridge) return;
  currentBridge = null;
  notifyBridgeListeners();
}

/** Текущий мост открытой доски или `null`, если доска закрыта. */
export function getWhiteboardBridge(): WhiteboardBridge | null {
  return currentBridge;
}

/** Открыта ли доска прямо сейчас (снимок для `useSyncExternalStore`). */
export function isWhiteboardOpen(): boolean {
  return currentBridge !== null;
}

/** Подписка на открытие/закрытие доски (для `useSyncExternalStore`). */
export function subscribeWhiteboardBridge(listener: BridgeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* -------------------------------------------------------------------------- */
/* Метод 1: снимок доски для Vision                                            */
/* -------------------------------------------------------------------------- */

/**
 * Снимок текущей страницы доски в формате PNG base64 (`data:image/png;base64,…`)
 * — готов к отправке в `/api/ai` и далее в Gemini Vision.
 * `null`, если доска закрыта или канва ещё не готова.
 */
export function getCanvasSnapshot(maxWidth?: number): string | null {
  if (!currentBridge) return null;
  try {
    return currentBridge.captureBoard(maxWidth);
  } catch (error) {
    console.warn("[whiteboard-bridge] не удалось снять копию доски:", error);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Формат компактной команды рисования                                         */
/* -------------------------------------------------------------------------- */

/**
 * Одна фигура компактной команды ИИ. Координаты — в «пространстве инструкции»
 * движка черчения (холст ≈1000×600, y растёт вниз): `x`/`y` — ЦЕНТР фигуры
 * (для `line`/`vector` — начало, конец — `x2`/`y2`), `size` — габарит фигуры
 * в px (для круга — диаметр). Полные формы движка (`shape` + `points` /
 * `center` / `from` / `to` / `topLeft` / `at`) тоже принимаются.
 */
export interface DrawShapeCommand {
  type?: string;
  shape?: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  size?: number;
  radius?: number;
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  label?: string;
  text?: string;
  fontSize?: number;
  points?: unknown;
  center?: unknown;
  from?: unknown;
  to?: unknown;
  topLeft?: unknown;
  at?: unknown;
  fn?: string;
  domain?: unknown;
  origin?: unknown;
  scale?: number;
}

/** JSON-команда рисования, которую ИИ возвращает по просьбе «нарисуй …». */
export interface DrawCommand {
  action: "draw";
  /** Компактные фигуры (`type`/`x`/`y`/`size`…). */
  shapes?: DrawShapeCommand[];
  /** Полные инструкции движка черчения (`shape` + геометрия). */
  drawing?: unknown[];
  instructions?: unknown[];
  /** Текстовое пояснение к чертежу (Markdown). */
  text?: string;
}

/** Результат выполнения команды рисования на доске. */
export interface DrawCommandResult {
  /** `true` — фигуры реально нарисованы (доска была открыта). */
  applied: boolean;
  /** Сколько фигур содержала команда. */
  count: number;
  /** Нормализованные инструкции — можно повторить позже, когда доску откроют. */
  instructions: DrawingInstruction[];
  /** Почему не нарисовалось: `board-closed` | `empty` | `error`. */
  reason?: "board-closed" | "empty" | "error";
}

/* -------------------------------------------------------------------------- */
/* Нормализация фигур → инструкции движка черчения                             */
/* -------------------------------------------------------------------------- */

const MAX_SHAPES = 40;
const DEFAULT_COLOR = "#2563eb";
const DEFAULT_STROKE = 4;
/** Центр холста инструкции по умолчанию (≈1000×600), если модель не дала координат. */
const DEFAULT_CENTER: [number, number] = [420, 260];

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RawRecord) : null;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Точка из `[x, y]` или `{x, y}` — модели присылают оба варианта. */
function asPoint(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = asNumber(value[0], Number.NaN);
    const y = asNumber(value[1], Number.NaN);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  const record = asRecord(value);
  if (record) {
    const x = asNumber(record.x, Number.NaN);
    const y = asNumber(record.y, Number.NaN);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  return null;
}

function asColor(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_COLOR;
  const color = value.trim();
  // Hex (`#ef4444`), именованные CSS-цвета и rgb()/hsl() — всё остальное отбрасываем.
  return /^#[0-9a-fA-F]{3,8}$/.test(color) || /^[a-zA-Z]{3,24}$/.test(color) || /^(rgb|hsl)a?\([\d\s.,%/]+\)$/.test(color)
    ? color
    : DEFAULT_COLOR;
}

const SHAPE_ALIASES: Record<string, string> = {
  triangle: "triangle",
  треугольник: "triangle",
  circle: "circle",
  круг: "circle",
  окружность: "circle",
  ellipse: "circle",
  rect: "rect",
  rectangle: "rect",
  прямоугольник: "rect",
  square: "rect",
  квадрат: "rect",
  line: "line",
  линия: "line",
  отрезок: "line",
  segment: "line",
  vector: "vector",
  вектор: "vector",
  arrow: "vector",
  стрелка: "vector",
  point: "point",
  точка: "point",
  dot: "point",
  text: "text",
  текст: "text",
  label: "text",
  подпись: "text",
  graph: "graph",
  график: "graph",
  function: "graph",
  функция: "graph",
};

/**
 * Превращает фигуры любого из двух форматов (компактного `type/x/y/size` и
 * полного `shape/points/center/…`) в валидные `DrawingInstruction[]` движка
 * черчения. Некорректные записи отбрасываются, числа зажимаются в разумные
 * пределы холста — битый JSON модели не может уронить доску.
 */
export function shapesToInstructions(shapes: unknown): DrawingInstruction[] {
  if (!Array.isArray(shapes)) return [];
  const result: DrawingInstruction[] = [];

  for (const item of shapes.slice(0, MAX_SHAPES)) {
    const raw = asRecord(item);
    if (!raw) continue;

    const rawType = typeof raw.type === "string" ? raw.type : typeof raw.shape === "string" ? raw.shape : "";
    const kind = SHAPE_ALIASES[rawType.trim().toLowerCase()];
    if (!kind) continue;

    const base = {
      color: asColor(raw.color),
      strokeWidth: clamp(Math.round(asNumber(raw.strokeWidth, DEFAULT_STROKE)), 1, 24),
      label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 64) : undefined,
    };

    const x = asNumber(raw.x, Number.NaN);
    const y = asNumber(raw.y, Number.NaN);
    const center: [number, number] =
      asPoint(raw.center) ?? (Number.isFinite(x) && Number.isFinite(y) ? [x, y] : DEFAULT_CENTER);
    const size = clamp(asNumber(raw.size, 140), 8, 1200);

    switch (kind) {
      case "triangle": {
        const rawPoints = Array.isArray(raw.points) ? raw.points.map(asPoint) : [];
        const points: [number, number][] =
          rawPoints.length === 3 && rawPoints.every((point) => point !== null)
            ? (rawPoints as [number, number][])
            : [
                [center[0], center[1] - size / 2],
                [center[0] - size / 2, center[1] + size / 2],
                [center[0] + size / 2, center[1] + size / 2],
              ];
        result.push({ shape: "triangle", ...base, points });
        break;
      }
      case "circle": {
        const radius = clamp(asNumber(raw.radius, Number.NaN) || size / 2, 4, 1000);
        result.push({ shape: "circle", ...base, center, radius });
        break;
      }
      case "rect": {
        const width = clamp(asNumber(raw.width, Number.NaN) || size * 1.4, 8, 1600);
        const height = clamp(asNumber(raw.height, Number.NaN) || size, 8, 1200);
        const topLeft = asPoint(raw.topLeft) ?? [center[0] - width / 2, center[1] - height / 2];
        result.push({ shape: "rect", ...base, topLeft, width, height });
        break;
      }
      case "line":
      case "vector": {
        const from =
          asPoint(raw.from) ??
          ([asNumber(raw.x1, Number.NaN) || center[0], asNumber(raw.y1, Number.NaN) || center[1]] as [number, number]);
        const x2 = asNumber(raw.x2, Number.NaN);
        const y2 = asNumber(raw.y2, Number.NaN);
        const to =
          asPoint(raw.to) ??
          (Number.isFinite(x2) && Number.isFinite(y2) ? ([x2, y2] as [number, number]) : ([from[0] + size, from[1]] as [number, number]));
        result.push(kind === "line" ? { shape: "line", ...base, from, to } : { shape: "vector", ...base, from, to });
        break;
      }
      case "point": {
        result.push({ shape: "point", ...base, at: asPoint(raw.at) ?? center });
        break;
      }
      case "text": {
        const text = typeof raw.text === "string" ? raw.text.trim() : typeof raw.label === "string" ? raw.label.trim() : "";
        if (!text) continue;
        result.push({
          shape: "text",
          ...base,
          label: undefined,
          at: asPoint(raw.at) ?? center,
          text: text.slice(0, 500),
          fontSize: clamp(Math.round(asNumber(raw.fontSize, 24)), 10, 96),
        });
        break;
      }
      case "graph": {
        const fnRaw = typeof raw.fn === "string" ? raw.fn.trim().toLowerCase() : "";
        const fn = fnRaw === "sine" || fnRaw === "sin" ? "sine" : fnRaw === "linear" ? "linear" : fnRaw === "cubic" ? "cubic" : "parabola";
        const domain = asPoint(raw.domain) ?? ([-5, 5] as [number, number]);
        result.push({
          shape: "graph",
          ...base,
          fn,
          domain: [domain[0], domain[1]],
          origin: asPoint(raw.origin) ?? center,
          scale: clamp(asNumber(raw.scale, 40), 4, 400),
        });
        break;
      }
      default:
        break;
    }
  }

  return result;
}

/**
 * Нормализует ЛЮБУЮ форму команды рисования в инструкции движка:
 * массив фигур, `{"action":"draw","shapes":[…]}`, `{"drawing":[…]}`,
 * одиночную фигуру или JSON-строку.
 */
export function commandToInstructions(command: unknown): DrawingInstruction[] {
  if (typeof command === "string") {
    const extracted = extractDrawCommand(command);
    if (extracted) return extracted.instructions;
    try {
      return commandToInstructions(JSON.parse(command) as unknown);
    } catch {
      return [];
    }
  }
  if (Array.isArray(command)) return shapesToInstructions(command);

  const record = asRecord(command);
  if (!record) return [];
  if (Array.isArray(record.shapes)) return shapesToInstructions(record.shapes);
  if (Array.isArray(record.drawing)) return shapesToInstructions(record.drawing);
  if (Array.isArray(record.instructions)) return shapesToInstructions(record.instructions);
  // Одиночная фигура без обёртки.
  if (typeof record.type === "string" || typeof record.shape === "string") return shapesToInstructions([record]);
  return [];
}

/* -------------------------------------------------------------------------- */
/* Перехват JSON-команды в текстовом ответе модели                             */
/* -------------------------------------------------------------------------- */

export interface ExtractedDrawCommand {
  /** Нормализованные инструкции для движка черчения. */
  instructions: DrawingInstruction[];
  /** Исходный разобранный JSON команды. */
  command: Record<string, unknown>;
  /** Текст ответа с вырезанной JSON-командой (для показа пользователю). */
  text: string;
}

/** Все сбалансированные `{…}`-фрагменты текста с их позициями. */
function findJsonSpans(text: string): Array<{ json: string; start: number; end: number }> {
  const spans: Array<{ json: string; start: number; end: number }> = [];

  // Fenced-блоки ```json … ``` — в первую очередь: их и вырезать целиком.
  const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenced: RegExpExecArray | null;
  while ((fenced = fencedPattern.exec(text)) !== null) {
    spans.push({ json: fenced[1].trim(), start: fenced.index, end: fenced.index + fenced[0].length });
  }

  // Голые сбалансированные объекты в прозе.
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          spans.push({ json: text.slice(start, i + 1), start, end: i + 1 });
          break;
        }
      }
    }
  }

  return spans;
}

function isDrawCommandRecord(record: Record<string, unknown>): boolean {
  if (record.action === "draw") return true;
  return Array.isArray(record.shapes) || Array.isArray(record.drawing) || Array.isArray(record.instructions);
}

/**
 * Ищет в тексте ответа ИИ JSON-команду рисования
 * (`{"action":"draw","shapes":[…]}` или `{"drawing":[…]}`), нормализует фигуры
 * и возвращает очищенный от JSON текст. `null` — команды в тексте нет.
 */
export function extractDrawCommand(text: string): ExtractedDrawCommand | null {
  if (!text || !text.includes("{")) return null;

  for (const span of findJsonSpans(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(span.json) as unknown;
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    if (!record || !isDrawCommandRecord(record)) continue;

    const instructions = commandToInstructions(record);
    if (instructions.length === 0) continue;

    let cleaned = `${text.slice(0, span.start)}${text.slice(span.end)}`.replace(/\n{3,}/g, "\n\n").trim();
    if (!cleaned && typeof record.text === "string") cleaned = record.text.trim();
    return { instructions, command: record, text: cleaned };
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Метод 2: выполнение команды рисования                                       */
/* -------------------------------------------------------------------------- */

/**
 * Выполняет инструкцию рисования на текущем холсте доски: треугольник, круг,
 * прямоугольник/квадрат, линия/стрелка, точка, текст или график функции.
 *
 * Принимает `DrawingInstruction[]`, компактную команду
 * `{"action":"draw","shapes":[…]}` или текст ответа ИИ с такой командой.
 * Если доска закрыта — НЕ теряет чертёж молча: возвращает
 * `applied: false, reason: "board-closed"` и сами инструкции, чтобы UI мог
 * предложить «Нарисовать на доске» после её открытия.
 */
export function drawCommand(command: DrawCommand | DrawingInstruction[] | string | unknown): DrawCommandResult {
  const instructions = commandToInstructions(command);
  if (instructions.length === 0) return { applied: false, count: 0, instructions, reason: "empty" };
  if (!currentBridge) return { applied: false, count: instructions.length, instructions, reason: "board-closed" };

  try {
    currentBridge.applyDrawing(instructions);
    return { applied: true, count: instructions.length, instructions };
  } catch (error) {
    console.warn("[whiteboard-bridge] не удалось нарисовать по команде ИИ:", error);
    return { applied: false, count: instructions.length, instructions, reason: "error" };
  }
}

/* -------------------------------------------------------------------------- */
/* Намерения пользователя (эвристики для ИИ-виджета)                           */
/* -------------------------------------------------------------------------- */

/** Просит ли пользователь что-то нарисовать/построить на доске. */
export function isDrawRequest(text: string): boolean {
  return /(нарисуй|нарисовать|построй|построить|начерти|черт[её]ж|изобрази|draw|plot)\b/i.test(text) ||
    /(нарисуй|построй|начерти)[^\n]{0,40}(треугольник|круг|окружность|квадрат|прямоугольник|график|схему|вектор|линию)/i.test(text);
}

/** Спрашивает ли пользователь про содержимое доски (нужен Vision-снимок). */
export function isBoardAnalysisRequest(text: string): boolean {
  return /(доск|на доске|что (тут|здесь|написано|нарисовано)|проанализ|посмотри|глянь|проверь (решение|выклад|написан)|распозна)/i.test(text);
}
