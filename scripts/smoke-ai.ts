/**
 * Смоук-тесты ИИ-движка SchoolMeet (этап 8).
 *
 * Запуск: `npm run test:ai`
 *
 * Проверяется всё, что не требует браузера, базы данных и РЕАЛЬНОЙ сети
 * (внешние API подменяются внедряемым `fetchImpl`):
 *  1. MockAIProvider отвечает на все действия русским текстом;
 *  2. `parseDrawingInstructions` отбрасывает некорректный JSON;
 *  3. `latexToReadableText` превращает LaTeX в читаемый Unicode-текст;
 *  4. утилиты парсинга ответов (extractJsonObject / extractLatex / stripThinkTags);
 *  5. GroqProvider: модель по действию, JSON-чертёж, отказ от изображений;
 *  6. GeminiProvider: inline_data для Vision, LaTeX из ответа, фоллбэк моделей при 404;
 *  7. OpenRouterProvider: text/vision-модели, image_url в сообщении;
 *  8. AutoAIProvider: waterfall-цепочки (текст → Groq, изображение → Gemini),
 *     авто-переключение при сбоях, работа БЕЗ ключей на локальном Mock;
 *  9. WebRTC-конфиг: STUN Google по умолчанию, NEXT_PUBLIC_TURN_SERVERS,
 *     legacy-override NEXT_PUBLIC_ICE_SERVERS, устойчивость к битому JSON.
 */

import {
  AI_ACTIONS,
  AIProviderError,
  AutoAIProvider,
  GeminiProvider,
  GroqProvider,
  MockAIProvider,
  OpenRouterProvider,
  getAIProvider,
  latexToReadableText,
  setAIProvider,
  type AIAction,
  type AIProvider,
  type AIRequest,
  type AIResponse,
  type HomeworkReviewDraft,
  type HomeworkReviewRequest,
} from "../src/lib/ai-provider";
import { extractJsonObject, extractLatex, stripThinkTags } from "../src/lib/ai-providers/shared";
import { parseDrawingInstructions } from "../src/lib/drawing-engine";
import { getIceServers, GOOGLE_STUN_URLS } from "../src/lib/webrtc-config";

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

/* -------------------------------------------------------------------------- */
/* Помощники: подставной fetch                                                 */
/* -------------------------------------------------------------------------- */

type FetchCall = { url: string; body: Record<string, unknown> };

/** fetchImpl, возвращающий заранее заготовленные JSON-ответы. */
function stubFetch(response: unknown, calls?: FetchCall[]) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    calls?.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

/** fetchImpl, который всегда падает (имитация сети/лимита). */
function failingFetch(message: string) {
  return async (): Promise<Response> => {
    throw new Error(message);
  };
}

/** fetchImpl, возвращающий произвольный статус. */
function statusFetch(status: number, text = "") {
  return async (): Promise<Response> => new Response(text || `HTTP ${status}`, { status });
}

const chatResponse = (content: string) => ({ choices: [{ message: { content } }] });
const geminiResponse = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

/** Записывающий провайдер-фейк для проверки порядка цепочки. */
function recordingProvider(id: string, log: string[], fail = false): AIProvider {
  return {
    id,
    name: id,
    isLocal: false,
    async complete(): Promise<AIResponse> {
      log.push(id);
      if (fail) throw new AIProviderError(`${id}: сбой`, { retryable: true });
      return { text: `ответ от ${id}`, providerId: id };
    },
    async reviewHomework(): Promise<HomeworkReviewDraft> {
      log.push(`${id}:review`);
      if (fail) throw new AIProviderError(`${id}: сбой`, { retryable: true });
      return { suggestedGrade: 4, draftComment: `черновик от ${id}`, providerId: id };
    },
  };
}

const REVIEW: HomeworkReviewRequest = {
  description: "Решите квадратное уравнение x² − 5x + 6 = 0.",
  answer: "D = 25 − 24 = 1; x₁ = 2, x₂ = 3.",
  maxScore: 5,
  attachmentCount: 0,
  isLate: false,
};

/* -------------------------------------------------------------------------- */
/* Тесты                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  // Гарантируем «чистое» окружение: внешние ключи не должны влиять на тесты.
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.AI_PROVIDER;
  setAIProvider(null);

  console.log("1. MockAIProvider: действия и ответы");
  const mock = new MockAIProvider();
  check("id провайдера = mock", mock.id === "mock");
  check("провайдер локальный (isLocal)", mock.isLocal === true);

  for (const action of AI_ACTIONS) {
    const response = await mock.complete({
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
        typeof response.latex === "string" && response.latex.length > 3 && /[=^_\\]/.test(response.latex),
        response.latex,
      );
    }
  }

  const mockReview = await mock.reviewHomework(REVIEW);
  check(
    "reviewHomework: оценка в диапазоне [1, maxScore]",
    mockReview.suggestedGrade >= 1 && mockReview.suggestedGrade <= REVIEW.maxScore,
    String(mockReview.suggestedGrade),
  );
  check("reviewHomework: непустой комментарий", mockReview.draftComment.length > 20);

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

  console.log("4. Утилиты парсинга ответов моделей");
  check(
    "extractJsonObject: JSON внутри текста",
    extractJsonObject('пояснение\n```json\n{"text":"ок","drawing":[]}\n```')?.text === "ок",
  );
  check(
    "extractJsonObject: сбалансированные скобки со строками",
    extractJsonObject('{"a":"строка с } скобкой","b":{"c":1}}')?.a === "строка с } скобкой",
  );
  check("extractJsonObject: мусор → null", extractJsonObject("просто текст без JSON") === null);
  check("extractLatex: из $$…$$", extractLatex("Смотрите: $$a^2 + b^2 = c^2$$ верно") === "a^2 + b^2 = c^2");
  check("extractLatex: из ```latex-блока", extractLatex("```latex\nF = ma\n```") === "F = ma");
  check("stripThinkTags: убирает размышления", stripThinkTags("<think>разбор</think>Ответ") === "Ответ");

  console.log("5. GroqProvider (stub fetch)");
  const groqCalls: FetchCall[] = [];
  const groq = new GroqProvider({
    apiKey: "gsk_test",
    fetchImpl: stubFetch(chatResponse("## Конспект\n\nОтличный урок."), groqCalls),
  });
  const groqText = await groq.complete({ action: "summary", prompt: "Теорема Пифагора" });
  check("текстовый ответ распарсен", groqText.text.includes("Конспект"));
  check("providerId = groq", groqText.providerId === "groq");
  check("модель текста = llama-3.3-70b-versatile", groqText.model === "llama-3.3-70b-versatile", groqText.model ?? "");
  check("URL = api.groq.com", groqCalls[0]?.url.includes("api.groq.com/openai/v1/chat/completions") === true);

  const groqSolve = await groq.complete({ action: "solve", prompt: "x² − 5x + 6 = 0" });
  check("solve → reasoning-модель DeepSeek R1", groqSolve.model === "deepseek-r1-distill-llama-70b", groqSolve.model ?? "");

  const groqDrawCalls: FetchCall[] = [];
  const groqDraw = new GroqProvider({
    apiKey: "gsk_test",
    fetchImpl: stubFetch(
      chatResponse('```json\n{"text":"## Чертёж","drawing":[{"shape":"circle","center":[100,100],"radius":50}]}\n```'),
      groqDrawCalls,
    ),
  });
  const drawResult = await groqDraw.complete({ action: "draw", prompt: "Окружность радиуса 50" });
  check("draw: JSON-инструкции извлечены", (drawResult.drawing?.length ?? 0) === 1);
  check("draw: запрошен json_object", JSON.stringify(groqDrawCalls[0]?.body).includes("json_object"));
  check("draw: инструкции проходят валидацию движка", parseDrawingInstructions(drawResult.drawing).length === 1);

  const groqReviewCalls: FetchCall[] = [];
  const groqReview = new GroqProvider({
    apiKey: "gsk_test",
    fetchImpl: stubFetch(chatResponse('{"suggestedGrade": 4, "draftComment": "Решение верное, но без проверки корней."}'), groqReviewCalls),
  });
  const review = await groqReview.reviewHomework(REVIEW);
  check("reviewHomework: оценка распарсена", review.suggestedGrade === 4);
  check("reviewHomework: комментарий распарсен", review.draftComment.includes("Решение верное"));

  let groqImageError: unknown = null;
  try {
    await groq.complete({ action: "formula", prompt: "распознай", imageDataUrl: "data:image/png;base64,AAAA" });
  } catch (error) {
    groqImageError = error;
  }
  check(
    "изображение → отказ (Groq текстовый)",
    groqImageError instanceof AIProviderError && groqImageError.retryable === false,
  );

  let rateLimited: unknown = null;
  const groq429 = new GroqProvider({ apiKey: "gsk_test", fetchImpl: statusFetch(429, "rate limit") });
  try {
    await groq429.complete({ action: "summary", prompt: "тест" });
  } catch (error) {
    rateLimited = error;
  }
  check("HTTP 429 → retryable-ошибка", rateLimited instanceof AIProviderError && rateLimited.retryable === true);
  check("Groq без ключа не создаётся", !GroqProvider.isAvailable({} as NodeJS.ProcessEnv));

  console.log("6. GeminiProvider (stub fetch)");
  const geminiCalls: FetchCall[] = [];
  const gemini = new GeminiProvider({
    apiKey: "AIza_test",
    fetchImpl: stubFetch(geminiResponse("$$E = mc^2$$"), geminiCalls),
  });
  const formula = await gemini.complete({
    action: "formula",
    prompt: "Распознай формулу с доски",
    imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
  });
  check("formula: LaTeX извлечён из $$…$$", formula.latex === "E = mc^2", formula.latex ?? "");
  check("formula: markdown-обёртка с latex-блоком", formula.text.includes("```latex"));
  check("formula: providerId = gemini", formula.providerId === "gemini");
  const geminiUrl = geminiCalls[0]?.url ?? "";
  check("URL содержит :generateContent", geminiUrl.includes(":generateContent") && geminiUrl.includes("gemini-2.0-flash"));
  const geminiParts = JSON.stringify(geminiCalls[0]?.body);
  check("изображение передано как inline_data (base64)", geminiParts.includes("inline_data") && geminiParts.includes("iVBORw0KGgo"));
  check("systemInstruction присутствует", geminiParts.includes("systemInstruction"));

  // Фоллбэк моделей: первая недоступна (404) → вторая отвечает.
  let requestIndex = 0;
  const geminiFallbackCalls: FetchCall[] = [];
  const geminiFallback = new GeminiProvider({
    apiKey: "AIza_test",
    fetchImpl: async (url, init) => {
      requestIndex += 1;
      geminiFallbackCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      if (requestIndex === 1) return new Response("NOT_FOUND", { status: 404 });
      return new Response(JSON.stringify(geminiResponse("## Конспект")), { status: 200 });
    },
  });
  const fallbackResult = await geminiFallback.complete({ action: "summary", prompt: "тема" });
  check("404 модели → авто-переключение на gemini-1.5-flash", requestIndex === 2 && fallbackResult.model === "gemini-1.5-flash", fallbackResult.model ?? "");

  console.log("7. OpenRouterProvider (stub fetch)");
  const orCalls: FetchCall[] = [];
  const openrouter = new OpenRouterProvider({
    apiKey: "sk-or_test",
    fetchImpl: stubFetch(chatResponse("## Решение\n\nx = 2, x = 3."), orCalls),
  });
  const orText = await openrouter.complete({ action: "solve", prompt: "x² − 5x + 6 = 0" });
  check("текстовый ответ распарсен", orText.text.includes("Решение"));
  check("модель :free по умолчанию", (orText.model ?? "").endsWith(":free"), orText.model ?? "");
  check("URL = openrouter.ai", (orCalls[0]?.url ?? "").includes("openrouter.ai/api/v1/chat/completions"));

  const orVisionCalls: FetchCall[] = [];
  const orVision = new OpenRouterProvider({
    apiKey: "sk-or_test",
    fetchImpl: stubFetch(chatResponse("a^2 + b^2 = c^2"), orVisionCalls),
  });
  const orFormula = await orVision.complete({
    action: "formula",
    prompt: "распознай",
    imageDataUrl: "data:image/png;base64,QQQQ",
  });
  check("formula: latex возвращён", orFormula.latex === "a^2 + b^2 = c^2");
  const orBody = JSON.stringify(orVisionCalls[0]?.body);
  check("изображение передано как image_url", orBody.includes("image_url") && orBody.includes("QQQQ"));
  check("vision-запрос ушёл в vision-модель", orBody.includes("gemini-2.0-flash-exp:free"));

  console.log("8. AutoAIProvider: waterfall-цепочки");
  // 8.1. Без ключей — всё локально (Mock), API не падает.
  const autoNoKeys = new AutoAIProvider({ env: {} as NodeJS.ProcessEnv });
  check("без ключей: isLocal = true", autoNoKeys.isLocal === true);
  check("без ключей: имя — MockAI", autoNoKeys.name.includes("MockAI"), autoNoKeys.name);
  const noKeysAnswer = await autoNoKeys.complete({ action: "summary", prompt: "Геометрия" });
  check("без ключей: ответ локального Mock", noKeysAnswer.text.length > 50 && noKeysAnswer.providerId === "mock");
  check("getAIProvider() (синглтон) тоже локальный", getAIProvider().isLocal === true);

  // 8.2. Текстовый запрос идёт по цепочке Groq → OpenRouter → Gemini → Mock.
  const log1: string[] = [];
  const autoText = new AutoAIProvider({
    env: {} as NodeJS.ProcessEnv,
    registry: {
      groq: recordingProvider("groq", log1, true), // Groq «упал» (лимит)
      openrouter: recordingProvider("openrouter", log1), // сработает OpenRouter
      gemini: recordingProvider("gemini", log1),
    },
  });
  const textAnswer = await autoText.complete({ action: "summary", prompt: "тема" });
  check("сбой Groq → авто-переключение на OpenRouter", log1.join(",") === "groq,openrouter", log1.join(","));
  check("ответ помечен провайдером", textAnswer.providerId === "openrouter");

  // 8.3. Запрос с изображением доски — сразу Gemini Vision.
  const log2: string[] = [];
  const autoVision = new AutoAIProvider({
    env: {} as NodeJS.ProcessEnv,
    registry: {
      groq: recordingProvider("groq", log2),
      gemini: recordingProvider("gemini", log2),
      openrouter: recordingProvider("openrouter", log2),
    },
  });
  await autoVision.complete({ action: "formula", prompt: "распознай", imageDataUrl: "data:image/png;base64,AAAA" });
  check("изображение → первым вызван Gemini (Groq пропущен)", log2[0] === "gemini" && !log2.includes("groq"), log2.join(","));

  // 8.4. Все внешние провайдеры упали → ответ всё равно есть (Mock).
  const log3: string[] = [];
  const autoAllFail = new AutoAIProvider({
    env: {} as NodeJS.ProcessEnv,
    registry: {
      groq: recordingProvider("groq", log3, true),
      openrouter: recordingProvider("openrouter", log3, true),
      gemini: recordingProvider("gemini", log3, true),
    },
  });
  const survivor = await autoAllFail.complete({ action: "solve", prompt: "задача" });
  check("полный сбой внешних → Mock спасает запрос", survivor.providerId === "mock" && survivor.text.length > 50);
  check("цепочка пройдена целиком", log3.length === 3, log3.join(","));

  // 8.5. reviewHomework тоже идёт по текстовой цепочке.
  const log4: string[] = [];
  const autoReview = new AutoAIProvider({
    env: {} as NodeJS.ProcessEnv,
    registry: { groq: recordingProvider("groq", log4, true) },
  });
  const reviewDraft = await autoReview.reviewHomework(REVIEW);
  check("reviewHomework: Groq сбой → Mock-черновик", log4[0] === "groq:review" && reviewDraft.suggestedGrade >= 1);

  // 8.6. Реальные провайдеры из env-ключей + сетевой сбой → Mock.
  const autoEnv = new AutoAIProvider({
    env: { GROQ_API_KEY: "gsk_env", GEMINI_API_KEY: "AIza_env" } as NodeJS.ProcessEnv,
  });
  check("env-ключи поднимают провайдеров", autoEnv.isLocal === false && autoEnv.name.includes("Groq"), autoEnv.name);
  const envGroq = (autoEnv as unknown as { registry: { groq?: GroqProvider } }).registry.groq;
  check("Groq создан из env", envGroq instanceof GroqProvider);

  // 8.7. Принудительный выбор AI_PROVIDER=mock.
  const autoForced = new AutoAIProvider({ env: { AI_PROVIDER: "mock", GROQ_API_KEY: "gsk_env" } as NodeJS.ProcessEnv });
  check("AI_PROVIDER=mock: только локальные ответы", autoForced.isLocal === true);

  console.log("9. WebRTC: STUN/TURN-конфигурация");
  const defaults = getIceServers({} as NodeJS.ProcessEnv);
  const defaultUrls = defaults.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
  check("по умолчанию — STUN-пул Google", defaultUrls.includes("stun:stun.l.google.com:19302") && defaultUrls.length === GOOGLE_STUN_URLS.length);
  check("зеркала Google STUN на месте", defaultUrls.includes("stun:stun4.l.google.com:19302"));

  const withTurn = getIceServers({
    NEXT_PUBLIC_TURN_SERVERS:
      '[{"urls":"turn:turn.school.ru:3478","username":"schoolmeet","credential":"secret"},"turns:turn.school.ru:5349"]',
  } as NodeJS.ProcessEnv);
  const turnUrls = withTurn.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
  check("TURN из NEXT_PUBLIC_TURN_SERVERS добавлен", turnUrls.includes("turn:turn.school.ru:3478") && turnUrls.includes("turns:turn.school.ru:5349"));
  const turnEntry = withTurn.find((s) => JSON.stringify(s.urls).includes("turn:turn.school.ru"));
  check("credentials TURN сохранены", turnEntry?.username === "schoolmeet" && turnEntry?.credential === "secret");
  check("STUN Google остаётся в списке", turnUrls.includes("stun:stun.l.google.com:19302"));

  const legacy = getIceServers({
    NEXT_PUBLIC_ICE_SERVERS: '[{"urls":"stun:stun.example.org:3478"}]',
    NEXT_PUBLIC_TURN_SERVERS: '["turn:ignored.example.org:3478"]',
  } as NodeJS.ProcessEnv);
  check("legacy NEXT_PUBLIC_ICE_SERVERS — полный override", legacy.length === 1 && legacy[0]?.urls === "stun:stun.example.org:3478");

  const broken = getIceServers({ NEXT_PUBLIC_TURN_SERVERS: "{не json" } as NodeJS.ProcessEnv);
  const brokenUrls = broken.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
  check("битый JSON → дефолтный STUN без падения", brokenUrls.includes("stun:stun.l.google.com:19302"));

  const junk = getIceServers({ NEXT_PUBLIC_TURN_SERVERS: '[{"urls":"http://bad"},{"urls":"turn:ok.example:3478"}]' } as NodeJS.ProcessEnv);
  const junkUrls = junk.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
  check("записи без stun/turn-схемы отброшены", !junkUrls.some((u) => u.startsWith("http")) && junkUrls.includes("turn:ok.example:3478"));

  console.log("10. Реальный транспорт: сетевой сбой → AIProviderError");
  const groqNet = new GroqProvider({ apiKey: "gsk_test", fetchImpl: failingFetch("fetch failed"), timeoutMs: 500 });
  let netError: unknown = null;
  try {
    await groqNet.complete({ action: "summary", prompt: "тест" });
  } catch (error) {
    netError = error;
  }
  check("сетевая ошибка → retryable AIProviderError", netError instanceof AIProviderError && netError.retryable === true);

  console.log("");
  console.log(`Итог: ${passed} проверок пройдено, ${failed} провалено.`);
  if (failed > 0) process.exit(1);
}

void main();
