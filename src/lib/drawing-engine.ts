/**
 * Движок автоматического черчения Лицея Сингулярити (этап 4).
 *
 * Принимает JSON-инструкции `MockAIProvider` (см. `src/lib/ai-provider.ts`) и
 * превращает их в объекты Fabric.js: треугольники, круги, отрезки, прямоугольники,
 * векторы со стрелкой, точки, подписи и графики функций.
 *
 * Модуль импортируется только на клиенте (нужен DOM-канвас Fabric.js).
 */

import { Circle, Ellipse, Group, Image, Line, Path, Polygon, Rect, Textbox, type Canvas, type FabricObject } from "fabric";

import { toSameOriginImageUrl } from "@/lib/ai-image";
import { commandToInstructions, shapesToInstructions } from "@/lib/whiteboard-bridge";
import type {
  AnyImageInstruction,
  ArcInstruction,
  BaseInstruction,
  CircleInstruction,
  DrawingInstruction,
  EllipseInstruction,
  GraphInstruction,
  ImageInstruction,
  LegacyImageInstruction,
  LineInstruction,
  PathInstruction,
  PointInstruction,
  PolygonInstruction,
  RectInstruction,
  TextInstruction,
  TriangleInstruction,
  VectorInstruction,
} from "@/lib/ai-provider";

export type { BaseInstruction, DrawingInstruction, ImageInstruction };

/** Актуальный `type: "image"` и прежний `shape: "image"` рендерятся одинаково. */
export function isImageInstruction(instruction: DrawingInstruction): instruction is AnyImageInstruction {
  return ("type" in instruction && instruction.type === "image") ||
    ("shape" in instruction && instruction.shape === "image");
}

/** Разрешённое количество фигур в одной инструкции. */
const MAX_INSTRUCTIONS = 40;

const DEFAULT_COLOR = "#2563eb";
/** Толщина линий ИИ-чертежей: эквивалент `ctx.lineWidth = 3`. */
const DEFAULT_STROKE = 3;
const LABEL_FONT_SIZE = 22;
const LABEL_FONT_FAMILY = "Arial, Helvetica, sans-serif";
const LABEL_COLOR = "#111827";
/** Чёткий отступ буквы вершины от угла фигуры, px. */
const VERTEX_LABEL_OFFSET = 24;

/* -------------------------------------------------------------------------- */
/* Валидация входящего JSON                                                    */
/* -------------------------------------------------------------------------- */

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RawRecord) : null;
}

function asPoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) ? [x, y] : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Разбирает и проверяет JSON-инструкции от ИИ. Некорректные записи
 * отбрасываются; возвращается только то, что движок гарантированно нарисует.
 */
export function parseDrawingInstructions(value: unknown): DrawingInstruction[] {
  // Компактная команда целиком ({"action":"draw","shapes":[…]}) — нормализуем
  // мостом и валидируем результат обычным путём.
  if (!Array.isArray(value)) {
    const normalized = commandToInstructions(value);
    return normalized.length > 0 ? parseDrawingInstructions(normalized) : [];
  }
  const result: DrawingInstruction[] = [];

  for (const item of value.slice(0, MAX_INSTRUCTIONS)) {
    const raw = asRecord(item);
    if (!raw) continue;

    // Актуальный формат изображения имеет собственный дискриминатор `type`,
    // размеры width/height и не обязан имитировать shape-based фигуры.
    if (!raw.shape && raw.type === "image") {
      const url = asString(raw.url).trim();
      const width = asNumber(raw.width, 0);
      const height = asNumber(raw.height, 0);
      const x = asNumber(raw.x, 0);
      const y = asNumber(raw.y, 0);
      if (!url || width <= 0 || height <= 0) continue;

      const opacity = typeof raw.opacity === "number" && Number.isFinite(raw.opacity)
        ? Math.min(1, Math.max(0, raw.opacity))
        : undefined;
      result.push({
        type: "image",
        id: asString(raw.id).trim() || undefined,
        url,
        x,
        y,
        width,
        height,
        opacity,
      } satisfies ImageInstruction);
      continue;
    }

    // Компактная фигура {"type":"triangle","x":100,"y":100,"size":80} вместо
    // полной {"shape":"triangle","points":[…]} — приводим через мост ИИ↔доска.
    if (!raw.shape && raw.type) {
      result.push(...shapesToInstructions([raw]));
      continue;
    }

    const shape = asString(raw.shape);
    const base = {
      color: asString(raw.color, DEFAULT_COLOR) || DEFAULT_COLOR,
      strokeWidth: asNumber(raw.strokeWidth, DEFAULT_STROKE),
      label: asString(raw.label) || undefined,
    };

    switch (shape) {
      case "triangle": {
        const points = Array.isArray(raw.points) ? raw.points.map(asPoint) : [];
        if (points.length !== 3 || points.some((point) => point === null)) continue;
        result.push({ shape: "triangle", ...base, points: points as TriangleInstruction["points"] });
        break;
      }
      case "circle": {
        const center = asPoint(raw.center);
        const radius = asNumber(raw.radius, 0);
        if (!center || radius <= 0 || radius > 2000) continue;
        result.push({ shape: "circle", ...base, center, radius } satisfies CircleInstruction);
        break;
      }
      case "line": {
        const from = asPoint(raw.from);
        const to = asPoint(raw.to);
        if (!from || !to) continue;
        result.push({ shape: "line", ...base, from, to } satisfies LineInstruction);
        break;
      }
      case "rect": {
        const topLeft = asPoint(raw.topLeft);
        const width = asNumber(raw.width, 0);
        const height = asNumber(raw.height, 0);
        if (!topLeft || width <= 0 || height <= 0) continue;
        result.push({ shape: "rect", ...base, topLeft, width, height } satisfies RectInstruction);
        break;
      }
      case "vector": {
        const from = asPoint(raw.from);
        const to = asPoint(raw.to);
        if (!from || !to) continue;
        result.push({ shape: "vector", ...base, from, to } satisfies VectorInstruction);
        break;
      }
      case "ellipse": {
        const center = asPoint(raw.center);
        const radiusX = asNumber(raw.radiusX, 0);
        const radiusY = asNumber(raw.radiusY, 0);
        if (!center || radiusX <= 0 || radiusY <= 0 || radiusX > 2000 || radiusY > 2000) continue;
        result.push({ shape: "ellipse", ...base, center, radiusX, radiusY } satisfies EllipseInstruction);
        break;
      }
      case "polygon": {
        const points = Array.isArray(raw.points) ? raw.points.map(asPoint) : [];
        if (points.length < 3 || points.some((point) => point === null)) continue;
        result.push({
          shape: "polygon", ...base, points: points as PolygonInstruction["points"],
          fill: asString(raw.fill) || undefined,
        } satisfies PolygonInstruction);
        break;
      }
      case "path": {
        const points = Array.isArray(raw.points) ? raw.points.map(asPoint) : [];
        if (points.length < 2 || points.some((point) => point === null)) continue;
        result.push({
          shape: "path", ...base, points: points as PathInstruction["points"],
          closed: raw.closed === true, fill: asString(raw.fill) || undefined,
        } satisfies PathInstruction);
        break;
      }
      case "arc": {
        const center = asPoint(raw.center);
        const radius = asNumber(raw.radius, 0);
        if (!center || radius <= 0 || radius > 2000) continue;
        result.push({
          shape: "arc", ...base, center, radius,
          startAngle: asNumber(raw.startAngle, 0), endAngle: asNumber(raw.endAngle, 180),
        } satisfies ArcInstruction);
        break;
      }
      case "graph": {
        const fn = asString(raw.fn);
        const domain = asPoint(raw.domain);
        const origin = asPoint(raw.origin);
        const scale = asNumber(raw.scale, 0);
        if (
          (fn !== "parabola" && fn !== "sine" && fn !== "linear" && fn !== "cubic") ||
          !domain ||
          !origin ||
          scale <= 0
        ) {
          continue;
        }
        result.push({
          shape: "graph",
          ...base,
          fn,
          domain: [domain[0], domain[1]],
          origin,
          scale,
        } satisfies GraphInstruction);
        break;
      }
      case "point": {
        const at = asPoint(raw.at);
        if (!at) continue;
        result.push({ shape: "point", ...base, at } satisfies PointInstruction);
        break;
      }
      case "text": {
        const at = asPoint(raw.at);
        const text = asString(raw.text);
        if (!at || !text) continue;
        result.push({
          shape: "text",
          ...base,
          at,
          text,
          fontSize: asNumber(raw.fontSize, 22),
        } satisfies TextInstruction);
        break;
      }
      case "image": {
        const url = asString(raw.url);
        const topLeft = asPoint(raw.topLeft ?? raw.at);
        const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : topLeft ? topLeft[0] : 0;
        const y = typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : topLeft ? topLeft[1] : 0;
        const w = asNumber(raw.width, asNumber(raw.w, 0));
        const h = asNumber(raw.height, asNumber(raw.h, 0));
        const prompt = asString(raw.prompt) || undefined;
        if (!url || w <= 0 || h <= 0) continue;
        result.push({ shape: "image", ...base, url, x, y, w, h, prompt } satisfies LegacyImageInstruction);
        break;
      }
      default:
        break;
    }
  }

  return result;
}

/**
 * Загружает картинку по URL и создаёт объект Fabric.Image с заданным размером и
 * позицией. Загрузка асинхронная — ошибка сети/битый URL не роняют cały чертёж:
 * возвращается `null`, и движок продолжает работу с остальными фигурами.
 */
export function buildImageObject(
  instruction: AnyImageInstruction,
  options: BuildOptions = {},
): Promise<FabricObject | null> {
  const offset = options.offset ?? { x: 0, y: 0 };
  const width = "width" in instruction ? instruction.width : instruction.w;
  const height = "height" in instruction ? instruction.height : instruction.h;
  const opacity = "type" in instruction ? instruction.opacity : undefined;

  // Ссылки на генератор ИИ переписываем на свой прокси: CSP разрешает картинки
  // только со своего origin, а сохранённые уроки содержат прямые внешние URL.
  const url = toSameOriginImageUrl(instruction.url);
  return Image.fromURL(url, { crossOrigin: "anonymous" }, {
    left: instruction.x + offset.x,
    top: instruction.y + offset.y,
    width,
    height,
    opacity,
    objectCaching: false,
    selectable: false,
    evented: false,
  })
    .then((image) => {
      const id = "type" in instruction ? instruction.id : undefined;
      if (id) (image as unknown as { id: string }).id = id;
      return image as unknown as FabricObject;
    })
    .catch((error) => {
      console.warn("[drawing-engine] не удалось загрузить картинку:", url, error);
      return null;
    });
}

/* -------------------------------------------------------------------------- */
/* Построение объектов Fabric.js                                               */
/* -------------------------------------------------------------------------- */

export interface BuildOptions {
  /** Смещение всех координат (куда вписать чертёж на канве). */
  offset?: { x: number; y: number };
}

function shift([x, y]: [number, number], offset: { x: number; y: number }): [number, number] {
  return [x + offset.x, y + offset.y];
}

/**
 * Сглаживание и чёткость векторных линий — точные эквиваленты настроек
 * 2D-контекста `ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 3`.
 * Применяется ко ВСЕМ фигурам ИИ-чертежа (треугольники, прямоугольники,
 * окружности, графики, линии и векторы).
 */
function sharpStroke(width: number): {
  strokeWidth: number;
  strokeLineCap: "round";
  strokeLineJoin: "round";
} {
  return { strokeWidth: width, strokeLineCap: "round", strokeLineJoin: "round" };
}

/** Убирает LaTeX-обёртку `$…$`: буквы вершин ($A$, $B$, $C$) должны читаться без шума. */
function cleanLabel(text: string): string {
  const trimmed = text.trim();
  const match = /^\$+\s*([^$]+?)\s*\$+$/.exec(trimmed);
  return (match ? match[1] : trimmed).trim();
}

function makeLabel(text: string, left: number, top: number): Textbox {
  const clean = cleanLabel(text);
  return new Textbox(clean, {
    left,
    top,
    fontSize: LABEL_FONT_SIZE,
    fill: LABEL_COLOR,
    fontFamily: LABEL_FONT_FAMILY,
    fontWeight: 600,
    editable: false,
    selectable: true,
    width: Math.max(28, clean.length * 14),
  });
}

/** Подпись, отцентрированная вокруг точки — для букв вершин и названий фигур. */
function makeCenteredLabel(text: string, cx: number, cy: number): Textbox {
  const clean = cleanLabel(text);
  const width = Math.max(28, clean.length * 14);
  return makeLabel(clean, cx - width / 2, cy - LABEL_FONT_SIZE * 0.65);
}

/** Центры фигур с углами (треугольник, прямоугольник) — от них выносятся буквы вершин. */
function shapeCentroids(instructions: DrawingInstruction[]): Array<[number, number]> {
  const centroids: Array<[number, number]> = [];
  for (const instruction of instructions) {
    if (isImageInstruction(instruction)) continue;
    if (instruction.shape === "triangle") {
      const count = instruction.points.length || 1;
      centroids.push([
        instruction.points.reduce((sum, [x]) => sum + x, 0) / count,
        instruction.points.reduce((sum, [, y]) => sum + y, 0) / count,
      ]);
    } else if (instruction.shape === "polygon" || instruction.shape === "path") {
      const count = instruction.points.length || 1;
      centroids.push([
        instruction.points.reduce((sum, [x]) => sum + x, 0) / count,
        instruction.points.reduce((sum, [, y]) => sum + y, 0) / count,
      ]);
    } else if (instruction.shape === "rect") {
      centroids.push([
        instruction.topLeft[0] + instruction.width / 2,
        instruction.topLeft[1] + instruction.height / 2,
      ]);
    }
  }
  return centroids;
}

/**
 * Позиция буквы вершины: подпись выносится НАРУЖУ от угла фигуры —
 * вектор «центр фигуры → вершина» продолжается на `VERTEX_LABEL_OFFSET` px,
 * чтобы буква ($A$, $B$, $C$) не налезала на линии и оставалась читаемой.
 */
function vertexLabelAnchor(at: [number, number], centroids: Array<[number, number]>): [number, number] {
  let nearest: [number, number] | null = null;
  let best = Infinity;
  for (const centroid of centroids) {
    const dist = Math.hypot(at[0] - centroid[0], at[1] - centroid[1]);
    if (dist > 8 && dist < best) {
      best = dist;
      nearest = centroid;
    }
  }
  if (nearest) {
    const nx = (at[0] - nearest[0]) / best;
    const ny = (at[1] - nearest[1]) / best;
    return [at[0] + nx * VERTEX_LABEL_OFFSET, at[1] + ny * VERTEX_LABEL_OFFSET];
  }
  // Одиночная точка без фигуры — классический отступ вверх-вправо.
  return [at[0] + 12, at[1] - 26];
}

function arrowHead(from: [number, number], to: [number, number], color: string, width: number): Polygon {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.max(12, width * 3.2);
  const spread = 0.42;

  return new Polygon(
    [
      { x: x2, y: y2 },
      { x: x2 - size * Math.cos(angle - spread), y: y2 - size * Math.sin(angle - spread) },
      { x: x2 - size * Math.cos(angle + spread), y: y2 - size * Math.sin(angle + spread) },
    ],
    {
      fill: color,
      stroke: color,
      // Polygon рендерится с `ctx.closePath()` — наконечник замыкается ровно.
      ...sharpStroke(1),
      originX: "left",
      originY: "top",
      objectCaching: false,
    },
  );
}

function graphPath(instruction: GraphInstruction, offset: { x: number; y: number }): string {
  const { fn, domain, origin, scale } = instruction;
  const samples = 48;
  const [d0, d1] = domain[0] < domain[1] ? domain : [domain[1], domain[0]];

  const valueAt = (t: number): number => {
    switch (fn) {
      case "parabola":
        return t * t;
      case "sine":
        return Math.sin(t);
      case "linear":
        return t;
      case "cubic":
        return (t * t * t) / 4;
    }
  };

  const points: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = d0 + ((d1 - d0) * i) / samples;
    const x = origin[0] + t * scale + offset.x;
    const y = origin[1] - valueAt(t) * scale + offset.y;
    points.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return points.join(" ");
}

/** SVG-path из точек: M … L … (+ Z при closed) — произвольные контуры ИИ. */
function pointsToPath(points: [number, number][], closed = false): string {
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  return closed ? `${d} Z` : d;
}

/** SVG-дуга окружности: углы в градусах, 0° — вправо, по часовой (y вниз). */
function arcPathD(center: [number, number], radius: number, startAngle: number, endAngle: number): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const start: [number, number] = [center[0] + radius * Math.cos(toRad(startAngle)), center[1] + radius * Math.sin(toRad(startAngle))];
  const end: [number, number] = [center[0] + radius * Math.cos(toRad(endAngle)), center[1] + radius * Math.sin(toRad(endAngle))];
  let sweepDeg = endAngle - startAngle;
  while (sweepDeg <= 0) sweepDeg += 360;
  if (sweepDeg >= 360) sweepDeg = 359.99;
  const largeArc = sweepDeg > 180 ? 1 : 0;
  return `M ${start[0].toFixed(2)} ${start[1].toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end[0].toFixed(2)} ${end[1].toFixed(2)}`;
}

function groupOf(parts: FabricObject[]): FabricObject {
  return new Group(parts, { subTargetCheck: false, interactive: false });
}

/**
 * Стрела «от точки к точке»: линия + наконечник одной группой.
 * Используется и движком черчения, и инструментом «Стрелка» на доске.
 */
export function createArrow(
  from: [number, number],
  to: [number, number],
  color: string,
  strokeWidth: number,
): FabricObject {
  const line = new Line([from[0], from[1], to[0], to[1]], {
    stroke: color,
    ...sharpStroke(strokeWidth),
    objectCaching: false,
  });
  const head = arrowHead(from, to, color, strokeWidth);
  return groupOf([line, head]);
}

/**
 * Превращает проверенные инструкции в объекты Fabric.js (не добавляя их на канву).
 * Каждый объект получает `customType` (`figure` / `text`), id назначает вызывающий код.
 */
export function buildObjectsFromInstructions(
  instructions: DrawingInstruction[],
  options: BuildOptions = {},
): FabricObject[] {
  const offset = options.offset ?? { x: 0, y: 0 };
  const objects: FabricObject[] = [];
  // Центры угловых фигур — чтобы выносить буквы вершин наружу от углов.
  const centroids = shapeCentroids(instructions);

  for (const instruction of instructions) {
    // Изображения загружаются асинхронно через buildImageObject.
    if (isImageInstruction(instruction)) continue;

    const stroke = instruction.strokeWidth ?? DEFAULT_STROKE;
    const color = instruction.color ?? DEFAULT_COLOR;

    switch (instruction.shape) {
      case "triangle": {
        const points = instruction.points.map((point) => shift(point, offset));
        // `Polygon` в Fabric рендерится через `ctx.closePath()` —
        // вершины треугольника замыкаются ровно, без щелей в углах.
        const polygon = new Polygon(
          points.map(([x, y]) => ({ x, y })),
          {
            fill: "transparent",
            stroke: color,
            ...sharpStroke(stroke),
            originX: "left",
            originY: "top",
            objectCaching: false,
          },
        );
        const cx = points.reduce((sum, p) => sum + p[0], 0) / 3;
        const cy = points.reduce((sum, p) => sum + p[1], 0) / 3;
        const parts: FabricObject[] = [polygon];
        if (instruction.label) parts.push(makeCenteredLabel(instruction.label, cx, cy));
        objects.push(groupOf(parts));
        break;
      }

      case "circle": {
        const [cx, cy] = shift(instruction.center, offset);
        const circle = new Circle({
          left: cx,
          top: cy,
          radius: instruction.radius,
          originX: "center",
          originY: "center",
          fill: "transparent",
          stroke: color,
          ...sharpStroke(stroke),
          objectCaching: false,
        });
        const parts: FabricObject[] = [circle];
        if (instruction.label) {
          parts.push(makeCenteredLabel(instruction.label, cx, cy - instruction.radius - 22));
        }
        objects.push(groupOf(parts));
        break;
      }

      case "line": {
        const from = shift(instruction.from, offset);
        const to = shift(instruction.to, offset);
        const line = new Line([from[0], from[1], to[0], to[1]], {
          stroke: color,
          ...sharpStroke(stroke),
          objectCaching: false,
        });
        const parts: FabricObject[] = [line];
        if (instruction.label) {
          const midX = (from[0] + to[0]) / 2;
          const midY = (from[1] + to[1]) / 2;
          parts.push(makeCenteredLabel(instruction.label, midX, midY - 26));
        }
        objects.push(groupOf(parts));
        break;
      }

      case "rect": {
        const [x, y] = shift(instruction.topLeft, offset);
        // `Rect` — замкнутый контур (эквивалент `ctx.closePath()` по периметру).
        const rect = new Rect({
          left: x,
          top: y,
          width: instruction.width,
          height: instruction.height,
          fill: "transparent",
          stroke: color,
          ...sharpStroke(stroke),
          objectCaching: false,
        });
        const parts: FabricObject[] = [rect];
        if (instruction.label) {
          parts.push(makeCenteredLabel(instruction.label, x + instruction.width / 2, y - 22));
        }
        objects.push(groupOf(parts));
        break;
      }

      case "vector": {
        const from = shift(instruction.from, offset);
        const to = shift(instruction.to, offset);
        const line = new Line([from[0], from[1], to[0], to[1]], {
          stroke: color,
          ...sharpStroke(stroke),
          objectCaching: false,
        });
        const head = arrowHead(from, to, color, stroke);
        const parts: FabricObject[] = [line, head];
        if (instruction.label) {
          parts.push(makeCenteredLabel(instruction.label, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - 30));
        }
        objects.push(groupOf(parts));
        break;
      }

      case "ellipse": {
        const [cx, cy] = shift(instruction.center, offset);
        const ellipse = new Ellipse({
          left: cx, top: cy, rx: instruction.radiusX, ry: instruction.radiusY,
          originX: "center", originY: "center", fill: "transparent", stroke: color,
          ...sharpStroke(stroke), objectCaching: false,
        });
        const parts: FabricObject[] = [ellipse];
        if (instruction.label) parts.push(makeCenteredLabel(instruction.label, cx, cy - instruction.radiusY - 22));
        objects.push(groupOf(parts));
        break;
      }

      case "polygon": {
        const points = instruction.points.map((point) => shift(point, offset));
        const polygon = new Polygon(points.map(([x, y]) => ({ x, y })), {
          fill: instruction.fill ?? "transparent", stroke: color, ...sharpStroke(stroke),
          originX: "left", originY: "top", objectCaching: false,
        });
        const cx = points.reduce((sum, pt) => sum + pt[0], 0) / points.length;
        const cy = points.reduce((sum, pt) => sum + pt[1], 0) / points.length;
        const parts: FabricObject[] = [polygon];
        if (instruction.label) parts.push(makeCenteredLabel(instruction.label, cx, cy));
        objects.push(groupOf(parts));
        break;
      }

      case "path": {
        const points = instruction.points.map((point) => shift(point, offset));
        const path = new Path(pointsToPath(points, instruction.closed), {
          fill: instruction.closed ? (instruction.fill ?? "transparent") : "", stroke: color,
          ...sharpStroke(stroke), objectCaching: false,
        });
        const parts: FabricObject[] = [path];
        if (instruction.label && points[0]) parts.push(makeCenteredLabel(instruction.label, points[0][0], points[0][1] - 22));
        objects.push(groupOf(parts));
        break;
      }

      case "arc": {
        const centerPt = shift(instruction.center, offset);
        const arc = new Path(arcPathD(centerPt, instruction.radius, instruction.startAngle, instruction.endAngle), {
          fill: "", stroke: color, ...sharpStroke(stroke), objectCaching: false,
        });
        const parts: FabricObject[] = [arc];
        if (instruction.label) parts.push(makeCenteredLabel(instruction.label, centerPt[0], centerPt[1] - instruction.radius - 22));
        objects.push(groupOf(parts));
        break;
      }

      case "graph": {
        const path = new Path(graphPath(instruction, offset), {
          fill: "",
          stroke: color,
          ...sharpStroke(stroke),
          objectCaching: false,
        });
        const parts: FabricObject[] = [path];
        if (instruction.label) {
          const [ox, oy] = shift(instruction.origin, offset);
          parts.push(makeCenteredLabel(instruction.label, ox + 34, oy - instruction.scale * 3));
        }
        objects.push(groupOf(parts));
        break;
      }

      case "point": {
        const [x, y] = shift(instruction.at, offset);
        const dot = new Circle({
          left: x,
          top: y,
          radius: Math.max(5, stroke + 2),
          originX: "center",
          originY: "center",
          fill: color,
          stroke: color,
          ...sharpStroke(1),
          objectCaching: false,
        });
        const parts: FabricObject[] = [dot];
        if (instruction.label) {
          // Буквы вершин ($A$, $B$, $C$) — с чётким отступом наружу от угла фигуры.
          const [ax, ay] = shift(vertexLabelAnchor(instruction.at, centroids), offset);
          parts.push(makeCenteredLabel(instruction.label, ax, ay));
        }
        objects.push(groupOf(parts));
        break;
      }

      case "text": {
        const [x, y] = shift(instruction.at, offset);
        const text = new Textbox(instruction.text, {
          left: x,
          top: y,
          fontSize: instruction.fontSize ?? 22,
          fill: color,
          fontFamily: LABEL_FONT_FAMILY,
          width: Math.max(120, instruction.text.length * 12),
        });
        objects.push(text);
        break;
      }
    }
  }

  return objects;
}

/**
 * Рисует инструкции прямо на канве Fabric.js (используется тестами и утилитами).
 * Векторные объекты возвращаются синхронно; изображения обоих форматов
 * добавляются на канву после загрузки, не блокируя остальной чертёж.
 * Обычный путь UI — `buildObjectsFromInstructions` + `useWhiteboard`, который
 * добавляет объекты со своим id и синхронизацией.
 */
export function drawInstructionsOnCanvas(
  canvas: Canvas,
  instructions: DrawingInstruction[],
  options: BuildOptions = {},
): FabricObject[] {
  const objects = buildObjectsFromInstructions(instructions, options);
  for (const object of objects) canvas.add(object);

  for (const instruction of instructions.filter(isImageInstruction)) {
    void buildImageObject(instruction, options).then((image) => {
      if (!image) return;
      canvas.add(image);
      canvas.requestRenderAll();
    });
  }

  canvas.requestRenderAll();
  return objects;
}
