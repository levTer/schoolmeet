/**
 * Движок автоматического черчения SchoolMeet (этап 4).
 *
 * Принимает JSON-инструкции `MockAIProvider` (см. `src/lib/ai-provider.ts`) и
 * превращает их в объекты Fabric.js: треугольники, круги, отрезки, прямоугольники,
 * векторы со стрелкой, точки, подписи и графики функций.
 *
 * Модуль импортируется только на клиенте (нужен DOM-канвас Fabric.js).
 */

import { Circle, Group, Line, Path, Polygon, Rect, Textbox, type Canvas, type FabricObject } from "fabric";

import type {
  CircleInstruction,
  DrawingInstruction,
  GraphInstruction,
  LineInstruction,
  PointInstruction,
  RectInstruction,
  TextInstruction,
  TriangleInstruction,
  VectorInstruction,
} from "@/lib/ai-provider";

/** Разрешённое количество фигур в одной инструкции. */
const MAX_INSTRUCTIONS = 40;

const DEFAULT_COLOR = "#2563eb";
const DEFAULT_STROKE = 4;
const LABEL_FONT_SIZE = 20;
const LABEL_COLOR = "#111827";

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
  if (!Array.isArray(value)) return [];
  const result: DrawingInstruction[] = [];

  for (const item of value.slice(0, MAX_INSTRUCTIONS)) {
    const raw = asRecord(item);
    if (!raw) continue;

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
      default:
        break;
    }
  }

  return result;
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

function makeLabel(text: string, left: number, top: number): Textbox {
  return new Textbox(text, {
    left,
    top,
    fontSize: LABEL_FONT_SIZE,
    fill: LABEL_COLOR,
    fontFamily: "sans-serif",
    editable: false,
    selectable: true,
    width: Math.max(28, text.length * 14),
  });
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
      strokeWidth: 1,
      strokeLineJoin: "round",
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
    strokeWidth,
    strokeLineCap: "round",
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

  for (const instruction of instructions) {
    const stroke = instruction.strokeWidth ?? DEFAULT_STROKE;
    const color = instruction.color ?? DEFAULT_COLOR;

    switch (instruction.shape) {
      case "triangle": {
        const points = instruction.points.map((point) => shift(point, offset));
        const polygon = new Polygon(
          points.map(([x, y]) => ({ x, y })),
          {
            fill: "transparent",
            stroke: color,
            strokeWidth: stroke,
            strokeLineJoin: "round",
            originX: "left",
            originY: "top",
            objectCaching: false,
          },
        );
        const cx = points.reduce((sum, p) => sum + p[0], 0) / 3;
        const cy = points.reduce((sum, p) => sum + p[1], 0) / 3;
        const parts: FabricObject[] = [polygon];
        if (instruction.label) parts.push(makeLabel(instruction.label, cx - 12, cy - 34));
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
          strokeWidth: stroke,
          objectCaching: false,
        });
        const parts: FabricObject[] = [circle];
        if (instruction.label) {
          parts.push(makeLabel(instruction.label, cx - 12, cy - instruction.radius - 32));
        }
        objects.push(groupOf(parts));
        break;
      }

      case "line": {
        const from = shift(instruction.from, offset);
        const to = shift(instruction.to, offset);
        const line = new Line([from[0], from[1], to[0], to[1]], {
          stroke: color,
          strokeWidth: stroke,
          strokeLineCap: "round",
          objectCaching: false,
        });
        const parts: FabricObject[] = [line];
        if (instruction.label) {
          const midX = (from[0] + to[0]) / 2;
          const midY = (from[1] + to[1]) / 2;
          parts.push(makeLabel(instruction.label, midX + 10, midY - 30));
        }
        objects.push(groupOf(parts));
        break;
      }

      case "rect": {
        const [x, y] = shift(instruction.topLeft, offset);
        const rect = new Rect({
          left: x,
          top: y,
          width: instruction.width,
          height: instruction.height,
          fill: "transparent",
          stroke: color,
          strokeWidth: stroke,
          objectCaching: false,
        });
        const parts: FabricObject[] = [rect];
        if (instruction.label) parts.push(makeLabel(instruction.label, x + 8, y - 32));
        objects.push(groupOf(parts));
        break;
      }

      case "vector": {
        const from = shift(instruction.from, offset);
        const to = shift(instruction.to, offset);
        const line = new Line([from[0], from[1], to[0], to[1]], {
          stroke: color,
          strokeWidth: stroke,
          strokeLineCap: "round",
          objectCaching: false,
        });
        const head = arrowHead(from, to, color, stroke);
        const parts: FabricObject[] = [line, head];
        if (instruction.label) {
          parts.push(makeLabel(instruction.label, (from[0] + to[0]) / 2 + 12, (from[1] + to[1]) / 2 - 34));
        }
        objects.push(groupOf(parts));
        break;
      }

      case "graph": {
        const path = new Path(graphPath(instruction, offset), {
          fill: "",
          stroke: color,
          strokeWidth: stroke,
          strokeLineCap: "round",
          strokeLineJoin: "round",
          objectCaching: false,
        });
        const parts: FabricObject[] = [path];
        if (instruction.label) {
          const [ox, oy] = shift(instruction.origin, offset);
          parts.push(makeLabel(instruction.label, ox + 24, oy - instruction.scale * 3));
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
          strokeWidth: 1,
          objectCaching: false,
        });
        const parts: FabricObject[] = [dot];
        if (instruction.label) parts.push(makeLabel(instruction.label, x + 10, y - 30));
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
          fontFamily: "sans-serif",
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
  canvas.requestRenderAll();
  return objects;
}
