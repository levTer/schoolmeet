/**
 * Тесты двустороннего моста «ИИ ↔ доска» (`src/lib/whiteboard-bridge.ts`) и
 * регрессионных паттернов тулбара доски. Запуск: `npm run test:bridge`.
 * Браузер, Fabric.js и сеть не нужны: мост чистый, а вёрстка фиксируется
 * проверками исходников (как в `ui-patterns.test.ts`).
 *
 * Зачем: панель инструментов однажды «пропала» (холст 16:9 накрыл её на
 * широких экранах), а свободная просьба «нарисуй треугольник» не доходила до
 * доски. Эти тесты не дают регрессиям вернуться.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildSystemPrompt, drawingFromModelJson, splitDrawCommand } from "../src/lib/ai-providers/shared";
import { parseDrawingInstructions } from "../src/lib/drawing-engine";
import {
  commandToInstructions,
  drawCommand,
  extractDrawCommand,
  getCanvasSnapshot,
  isBoardAnalysisRequest,
  isDrawRequest,
  isWhiteboardOpen,
  registerWhiteboardBridge,
  shapesToInstructions,
  unregisterWhiteboardBridge,
  type WhiteboardBridge,
} from "../src/lib/whiteboard-bridge";
import type { DrawingInstruction } from "../src/lib/ai-provider";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/* -------------------------------------------------------------------------- */
/* Компактная команда ИИ → инструкции движка                                   */
/* -------------------------------------------------------------------------- */

describe("shapesToInstructions: компактные фигуры {type,x,y,size}", () => {
  it("треугольник из примера ТЗ превращается в 3 точки нужного цвета", () => {
    const [instruction] = shapesToInstructions([{ type: "triangle", x: 100, y: 100, size: 80, color: "#ef4444" }]);
    assert.equal(instruction.shape, "triangle");
    assert.equal(instruction.color, "#ef4444");
    const points = instruction.shape === "triangle" ? instruction.points : [];
    assert.equal(points.length, 3);
    // Центр фигуры — (100,100), габарит 80px: вершина сверху по центру.
    assert.deepEqual(points[0], [100, 60]);
  });

  it("круг, квадрат, линия и текст", () => {
    const instructions = shapesToInstructions([
      { type: "circle", x: 200, y: 150, size: 100 },
      { type: "rect", x: 300, y: 200, width: 120, height: 80 },
      { type: "line", x: 0, y: 0, x2: 90, y2: 120 },
      { type: "text", x: 50, y: 40, text: "Теорема Пифагора" },
    ]);
    assert.deepEqual(
      instructions.map((item) => item.shape),
      ["circle", "rect", "line", "text"],
    );
    const circle = instructions[0];
    assert.equal(circle.shape === "circle" ? circle.radius : 0, 50); // size = диаметр
    const rect = instructions[1];
    assert.deepEqual(rect.shape === "rect" ? rect.topLeft : null, [240, 160]);
    const line = instructions[2];
    assert.deepEqual(line.shape === "line" ? line.to : null, [90, 120]);
  });

  it("русские алиасы и битые записи не ломают разбор", () => {
    const instructions = shapesToInstructions([
      { type: "треугольник", x: 10, y: 10, size: 60 },
      { type: "неизвестная фигура" },
      null,
      "строка вместо объекта",
      { type: "circle", x: "не число", size: Number.NaN },
    ]);
    assert.equal(instructions.length, 2);
    assert.equal(instructions[0].shape, "triangle");
    assert.equal(instructions[1].shape, "circle");
  });

  it("полный формат движка (shape+points) пропускается без искажений", () => {
    const [instruction] = shapesToInstructions([
      { shape: "triangle", points: [[0, 0], [100, 0], [50, 80]], color: "#22c55e" },
    ]);
    assert.equal(instruction.shape, "triangle");
    assert.deepEqual(instruction.shape === "triangle" ? instruction.points : null, [[0, 0], [100, 0], [50, 80]]);
  });
});

describe("commandToInstructions / extractDrawCommand", () => {
  it("команда {action:draw, shapes} целиком", () => {
    const instructions = commandToInstructions({
      action: "draw",
      shapes: [{ type: "triangle", x: 100, y: 100, size: 80, color: "#ef4444" }],
    });
    assert.equal(instructions.length, 1);
    assert.equal(instructions[0].shape, "triangle");
  });

  it("JSON-команда перехватывается в ```json-блоке ответа и вырезается из текста", () => {
    const answer = [
      "Рисую красный треугольник на доске.",
      "",
      '```json',
      '{"action":"draw","shapes":[{"type":"triangle","x":100,"y":100,"size":80,"color":"#ef4444"}]}',
      '```',
    ].join("\n");
    const extracted = extractDrawCommand(answer);
    assert.ok(extracted, "команда не перехвачена");
    assert.equal(extracted.instructions.length, 1);
    assert.match(extracted.text, /Рисую красный треугольник/);
    assert.ok(!extracted.text.includes('"action"'), "JSON остался в видимом тексте");
  });

  it("обычный текст без команды → null", () => {
    assert.equal(extractDrawCommand("Теорема Пифагора: c² = a² + b²."), null);
    assert.deepEqual(commandToInstructions({ unrelated: true }), []);
  });
});

/* -------------------------------------------------------------------------- */
/* Реестр моста: снимок и рисование                                            */
/* -------------------------------------------------------------------------- */

describe("реестр моста: getCanvasSnapshot / drawCommand", () => {
  it("без открытой доски снимок null, а чертёж не теряется молча", () => {
    unregisterWhiteboardBridge();
    assert.equal(isWhiteboardOpen(), false);
    assert.equal(getCanvasSnapshot(), null);

    const result = drawCommand({
      action: "draw",
      shapes: [{ type: "circle", x: 100, y: 100, size: 80 }],
    });
    assert.equal(result.applied, false);
    assert.equal(result.reason, "board-closed");
    assert.equal(result.count, 1);
    assert.equal(result.instructions.length, 1); // можно повторить после открытия доски
  });

  it("с зарегистрированной доской снимок отдаётся, а команда рисуется", () => {
    const drawn: DrawingInstruction[][] = [];
    const fakeBridge: WhiteboardBridge = {
      captureBoard: () => "data:image/png;base64,AAAA",
      applyDrawing: (instructions) => {
        drawn.push(instructions);
      },
    };
    const unregister = registerWhiteboardBridge(fakeBridge);
    try {
      assert.equal(isWhiteboardOpen(), true);
      assert.equal(getCanvasSnapshot(), "data:image/png;base64,AAAA");

      const result = drawCommand('{"action":"draw","shapes":[{"type":"triangle","x":100,"y":100,"size":80,"color":"#ef4444"}]}');
      assert.equal(result.applied, true);
      assert.equal(result.count, 1);
      assert.equal(drawn[0]?.[0]?.shape, "triangle");
    } finally {
      unregister();
    }
    assert.equal(isWhiteboardOpen(), false);
  });
});

/* -------------------------------------------------------------------------- */
/* Серверные парсеры и системные промпты                                       */
/* -------------------------------------------------------------------------- */

describe("провайдерские парсеры и промпты (shared.ts)", () => {
  it("drawingFromModelJson принимает оба формата чертежа", () => {
    assert.equal(drawingFromModelJson({ action: "draw", shapes: [{ type: "circle", x: 1, y: 2, size: 40 }] })?.length, 1);
    assert.equal(
      drawingFromModelJson({ drawing: [{ shape: "circle", center: [10, 10], radius: 25 }] })?.length,
      1,
    );
    assert.equal(drawingFromModelJson({ text: "без чертежа" }), undefined);
    assert.equal(drawingFromModelJson(null), undefined);
  });

  it("splitDrawCommand отделяет команду рисования от прозы", () => {
    const split = splitDrawCommand(
      'Готово!\n\n```json\n{"action":"draw","shapes":[{"type":"rect","x":50,"y":50,"size":60}]}\n```',
    );
    assert.equal(split.drawing?.length, 1);
    assert.match(split.text, /Готово/);
  });

  it("промпт ask требует JSON-команду при просьбе нарисовать, draw описывает компактный формат", () => {
    assert.match(buildSystemPrompt("ask", "Геометрия"), /\{"action":"draw","shapes":/);
    assert.match(buildSystemPrompt("draw", "Геометрия"), /компактная команда моста доски/);
  });

  it("Vision-промпт анализа доски подключается и к solve/check при приложенном снимке", () => {
    for (const action of ["ask", "solve", "check", "summary"] as const) {
      assert.match(buildSystemPrompt(action, "Алгебра", true), /Что на доске/, `нет Vision-разбора у ${action}`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Движок черчения принимает команды моста                                     */
/* -------------------------------------------------------------------------- */

describe("parseDrawingInstructions принимает формат моста", () => {
  it("массив компактных фигур и команда целиком", () => {
    assert.equal(parseDrawingInstructions([{ type: "triangle", x: 100, y: 100, size: 80 }]).length, 1);
    const fromCommand = parseDrawingInstructions({
      action: "draw",
      shapes: [{ type: "circle", x: 10, y: 10, size: 50 }],
    });
    assert.equal(fromCommand.length, 1);
    assert.equal(fromCommand[0].shape, "circle");
  });
});

/* -------------------------------------------------------------------------- */
/* Эвристики намерений                                                          */
/* -------------------------------------------------------------------------- */

describe("намерения пользователя", () => {
  it("просьбы нарисовать распознаются", () => {
    assert.equal(isDrawRequest("Нарисуй треугольник ABC"), true);
    assert.equal(isDrawRequest("построй график параболы"), true);
    assert.equal(isDrawRequest("Объясни теорему Пифагора"), false);
  });

  it("вопросы про доску требуют снимок", () => {
    assert.equal(isBoardAnalysisRequest("Что написано на доске?"), true);
    assert.equal(isBoardAnalysisRequest("Проанализируй доску"), true);
    assert.equal(isBoardAnalysisRequest("Реши уравнение 2x+3=7"), false);
  });
});

/* -------------------------------------------------------------------------- */
/* Регрессионные паттерны вёрстки и проводки                                    */
/* -------------------------------------------------------------------------- */

describe("тулбар доски и проводка моста (исходники)", () => {
  const board = readSource("src/components/meeting/Whiteboard.tsx");
  const hook = readSource("src/hooks/useWhiteboard.ts");
  const assistant = readSource("src/components/meeting/AIAssistant.tsx");
  const widget = readSource("src/components/meeting/AIWidget.tsx");
  const css = readSource("src/app/globals.css");

  it("тулбар видим: relative z-30, непрозрачный фон, не сжимается", () => {
    assert.match(board, /whiteboard-toolbar relative z-30/, "тулбар без z-30 — холст может его накрыть");
    assert.match(board, /role="toolbar"/, "нет роли toolbar");
    assert.match(css, /\.whiteboard-toolbar \{\s*\n\s*position: relative;\s*\n\s*z-index: 30;/, "нет CSS-страховки тулбара");
  });

  it("холст вписан в область по высоте (container units) и не вылезает под тулбар", () => {
    assert.match(board, /\[container-type:size\]/, "нет контейнерных единиц у обёртки канвы");
    assert.match(board, /177\.778cqh/, "ширина холста не ограничена высотой области");
    assert.match(board, /relative z-0 flex min-h-0 flex-1 gap-3 overflow-hidden/, "область канвы не обрезает вылезающее");
  });

  it("инструменты: карандаш, треугольник, круг, квадрат, текст, ластик; палитра из базовых пяти цветов", () => {
    for (const tool of ["pencil", "triangle", "circle", "rect", "text", "eraser"]) {
      assert.match(board, new RegExp(`tool: "${tool}"`), `нет инструмента ${tool} в тулбаре`);
      assert.match(hook, new RegExp(`"${tool}"`), `хук доски не знает инструмент ${tool}`);
    }
    for (const color of ["#000000", "#ffffff", "#ef4444", "#3b82f6", "#22c55e"]) {
      assert.ok(board.includes(`"${color}"`), `в палитре нет базового цвета ${color}`);
    }
    assert.match(board, /Очистить страницу/, "нет кнопки очистки доски");
    assert.match(board, /Толщина/, "нет настройки размера кисти");
  });

  it("доска регистрируется в мосте, ИИ-виджет пользуется getCanvasSnapshot/drawCommand", () => {
    assert.match(board, /registerWhiteboardBridge/, "доска не регистрируется в мосте");
    assert.match(assistant, /getCanvasSnapshot/, "виджет не забирает снимок доски через мост");
    assert.match(assistant, /drawCommand\(/, "виджет не рисует по команде моста");
    assert.match(assistant, /Проанализировать доску/, "нет кнопки «Проанализировать доску»");
    assert.match(assistant, /extractDrawCommand/, "виджет не перехватывает JSON-команды рисования в тексте");
    assert.match(widget, /drawCommand/, "AIWidget не подключён к мосту по умолчанию");
  });

  it("хук валидирует инструкции ИИ перед рисованием", () => {
    assert.match(hook, /parseDrawingInstructions\(instructions\)/, "applyDrawing не валидирует JSON модели");
  });
});

/* -------------------------------------------------------------------------- */
/* Чёткость ИИ-чертежей (drawing-engine.ts)                                    */
/* -------------------------------------------------------------------------- */

describe("чёткость векторных ИИ-чертежей (исходники движка)", () => {
  const engine = readSource("src/lib/drawing-engine.ts");

  it("линии сглажены и толщиной 3 — lineCap/lineJoin round, lineWidth 3", () => {
    assert.match(engine, /strokeLineCap: "round"/, "концы линий не сглажены (ctx.lineCap)");
    assert.match(engine, /strokeLineJoin: "round"/, "стыки линий не сглажены (ctx.lineJoin)");
    assert.match(engine, /DEFAULT_STROKE = 3/, "толщина линий ИИ-чертежей не равна 3 (ctx.lineWidth)");
  });

  it("вершины фигур замыкаются ровно (closePath), буквы вершин читаемы", () => {
    assert.match(engine, /closePath/, "фигуры не замыкаются ровно (ctx.closePath)");
    assert.match(engine, /VERTEX_LABEL_OFFSET/, "буквы вершин без чёткого отступа от углов");
    assert.match(engine, /fontWeight: 600/, "подписи вершин без читаемого жирного шрифта");
    assert.match(engine, /vertexLabelAnchor/, "буквы вершин не выносятся наружу от углов фигуры");
  });
});
