/**
 * Смоук-тесты локальной ИИ-архитектуры (этап 4).
 *
 * Запуск: `npm run test:ai`
 *
 * Проверяется всё, что не требует браузера и базы данных:
 *  1. MockAIProvider отвечает на все действия русским текстом;
 *  2. для действия `draw` возвращаются валидные JSON-инструкции для черчения;
 *  3. для действия `formula` возвращается LaTeX;
 *  4. `parseDrawingInstructions` отбрасывает некорректный JSON;
 *  5. `latexToReadableText` превращает LaTeX в читаемый Unicode-текст;
 *  6. `getAIProvider()` возвращает локальный Mock (внешние сети не нужны).
 */

import {
  AI_ACTIONS,
  getAIProvider,
  latexToReadableText,
  MockAIProvider,
  type AIAction,
} from "../src/lib/ai-provider";
import { parseDrawingInstructions } from "../src/lib/drawing-engine";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, details = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${details ? ` — ${details}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("1. MockAIProvider: действия и ответы");
  const provider = getAIProvider();
  check("провайдер локальный (isLocal)", provider.isLocal === true);
  check("провайдер — MockAIProvider", provider instanceof MockAIProvider);
  check("id провайдера = mock", provider.id === "mock");

  for (const action of AI_ACTIONS) {
    const response = await provider.complete({
      action: action as AIAction,
      prompt: "Теорема Пифагора, прямоугольный треугольник",
      context: { meetingTitle: "Математика, 7 класс" },
    });
    check(`действие "${action}": непустой markdown`, typeof response.text === "string" && response.text.length > 50);

    if (action === "draw") {
      check(
        `действие "draw": есть инструкции черчения`,
        Array.isArray(response.drawing) && (response.drawing?.length ?? 0) > 0,
      );
    }
    if (action === "formula") {
      check(
        `действие "formula": есть LaTeX`,
        typeof response.latex === "string" &&
          response.latex.length > 3 &&
          /[=^_\\]/.test(response.latex),
        response.latex,
      );
    }
  }

  console.log("2. parseDrawingInstructions: валидация JSON");
  const valid = parseDrawingInstructions([
    { shape: "triangle", points: [[0, 0], [100, 0], [50, 80]], color: "#111", label: "ABC" },
    { shape: "circle", center: [200, 200], radius: 50 },
    { shape: "vector", from: [0, 0], to: [10, 10] },
    { shape: "graph", fn: "parabola", domain: [-2, 2], origin: [50, 50], scale: 10 },
  ]);
  check("валидные инструкции проходят", valid.length === 4, `получено ${valid.length}`);

  const invalid = parseDrawingInstructions([
    { shape: "triangle", points: [[0, 0]] },
    { shape: "circle", center: [1, 2], radius: -5 },
    { shape: "nope" },
    "не объект",
    { shape: "graph", fn: "hyperbola", domain: [0, 1], origin: [0, 0], scale: 1 },
  ]);
  check("мусор отбрасывается", invalid.length === 0, `прошло ${invalid.length}`);
  check("не-массив → пустой список", parseDrawingInstructions("oops").length === 0);

  console.log("3. latexToReadableText: LaTeX → текст для доски");
  const readable = latexToReadableText("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}");
  check("дробь и корень читаются", readable.includes("√") && readable.includes("±"), readable);
  check("степени → верхние индексы", latexToReadableText("a^2 + b^2").includes("²"));
  check("индексы → нижние индексы", latexToReadableText("x_{1}").includes("₁"));

  console.log("");
  console.log(`Итог: ${passed} проверок пройдено, ${failed} провалено.`);
  if (failed > 0) process.exit(1);
}

void main();
