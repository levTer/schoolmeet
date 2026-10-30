/**
 * Смоук-тесты ИИ-движка Лицея Сингулярити (этап 8).
 *
 * Запуск: `npm run test:ai`
 *
 * Проверяется всё, что не требует браузера, базы данных и РЕАЛЬНОЙ сети
 * (внешние API подменяются внедряемым `fetchImpl`):
 *  1. MockAIProvider отвечает на все действия русским текстом;
 *  2. `parseDrawingInstructions` отбрасывает некорректный JSON;
 *  3. `latexToReadableText` превращает LaTeX в читаемый Unicode-текст;
 *  4. утилиты парсинга ответов (extractJsonObject / extractLatex / stripThinkTags);
 *  5. GroqProvider: модель по действию, JSON-чертёж, Groq Vision для снимка
 *     доски, мгновенный перебор моделей при 404/`model_decommissioned`;
 *  6. GeminiProvider: inline_data для Vision, LaTeX из ответа, v1beta REST-URL
 *     с ключом в `?key=`, перебор моделей при 404 NOT_FOUND;
 *  7. OpenRouterProvider: text/vision-модели, image_url в сообщении;
 *  8. AutoAIProvider: waterfall-цепочки (текст → Groq, изображение →
 *     Groq Vision (ОСНОВНОЙ, llama-3.2-11b-vision-preview) → Gemini Vision),
 *     авто-переключение при сбоях, работа БЕЗ ключей на локальном Mock;
 *  9. WebRTC-конфиг: STUN Google по умолчанию, NEXT_PUBLIC_TURN_SERVERS,
 *     legacy-override NEXT_PUBLIC_ICE_SERVERS, устойчивость к битому JSON.
 */

import {
  AI_ACTIONS,
  AIProviderError,
  AutoAIProvider,
  GEMINI_DEFAULT_MODEL,
  GEMINI_FALLBACK_MODELS,
  GROQ_DEFAULT_VISION_MODEL,
  GROQ_FALLBACK_MODELS,
  GeminiProvider,
  GroqProvider,
  MockAIProvider,
  OpenRouterProvider,
  geminiGenerateContentUrl,
  getAIProvider,
  isModelUnavailableError,
  latexToReadableText,
  resolveGeminiModel,
  setAIProvider,
  VISION_CHAIN,
  GROQ_VISION_BOARD_PROMPT,
  type AIAction,
  type AIProvider,
  type AIResponse,
  type HomeworkReviewDraft,
  type HomeworkReviewRequest,
} from "../src/lib/ai-provider";
import { extractJsonObject, extractLatex, stripThinkTags } from "../src/lib/ai-providers/shared";
import { parseDrawingInstructions } from "../src/lib/drawing-engine";
import { getIceServers, getRelayIceServers, getRelayRtcConfiguration } from "../src/lib/webrtc-config";

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

  // Локальный резерв больше не «отказывается» видеть доску: снимок уходит
  // в Gemini/Groq Vision, а заглушки про неумение распознавать изображения нет.
  const mockBoard = await mock.complete({
    action: "ask",
    prompt: "Что написано на доске?",
    imageDataUrl: "data:image/png;base64,AAAA",
  });
  check("mock: снимок доски не роняет запрос", mockBoard.text.length > 50);
  check(
    "mock: нет заглушки «не умеет распознавать изображения»",
    !/не умеет распознавать изображения/i.test(mockBoard.text),
    mockBoard.text.slice(0, 80),
  );

  console.log("2. parseDrawingInstructions: валидация JSON");
  const valid = parseDrawingInstructions([
    { shape: "triangle", points: [[0, 0], [100, 0], [50, 80]], color: "#111", label: "ABC" },
    { shape: "circle", center: [200, 200], radius: 50 },
    { shape: "vector", from: [0, 0], to: [10, 10] },
    { shape: "graph", fn: "parabola", domain: [-2, 2], origin: [50, 50], scale: 10 },
  ]);
  check("валидные инструкции проходят", valid.length === 4, `получено ${valid.length}`);
  const composite = parseDrawingInstructions([
    { shape: "rect", topLeft: [150, 150], width: 120, height: 100, color: "#3b82f6" },
    { shape: "polygon", points: [[140, 150], [210, 100], [280, 150]], color: "#ef4444" },
    { shape: "ellipse", center: [400, 200], radiusX: 80, radiusY: 40 },
    { shape: "path", points: [[0, 0], [50, 50], [100, 0]], closed: false },
    { shape: "arc", center: [300, 300], radius: 60, startAngle: 0, endAngle: 180 },
    { shape: "text", at: [210, 80], text: "Домик" },
  ]);
  check("составные примитивы rect/polygon/ellipse/path/arc/text проходят", composite.length === 6, `получено ${composite.length}`);
  const imageInstructions = parseDrawingInstructions([
    {
      shape: "image",
      url: "https://image.pollinations.ai/prompt/cell?width=512&height=512",
      x: 300,
      y: 200,
      w: 320,
      h: 320,
      prompt: "cell",
    },
    { shape: "image", url: "", x: 0, y: 0, w: 100, h: 100 },
    { shape: "image", url: "https://example.com/a.png", x: 0, y: 0, w: 0, h: 100 },
  ]);
  check(
    "примитив image проходит валидацию с prompt и отсекает пустой url/размер",
    imageInstructions.length === 1 &&
      imageInstructions[0]?.shape === "image" &&
      imageInstructions[0].prompt === "cell",
    `получено ${imageInstructions.length}`,
  );
  const typedImageInstructions = parseDrawingInstructions([
    {
      type: "image",
      id: "diagram-1",
      url: "https://example.com/diagram.png",
      x: 40,
      y: 60,
      width: 480,
      height: 270,
      opacity: 0.65,
    },
    { type: "image", url: "https://example.com/broken.png", x: 0, y: 0, width: 0, height: 100 },
  ]);
  const typedImage = typedImageInstructions[0];
  check(
    "type-based image сохраняет id, width/height и opacity",
    typedImageInstructions.length === 1 &&
      typedImage !== undefined &&
      "type" in typedImage &&
      typedImage.type === "image" &&
      typedImage.id === "diagram-1" &&
      typedImage.width === 480 &&
      typedImage.height === 270 &&
      typedImage.opacity === 0.65,
  );
  const badComposite = parseDrawingInstructions([
    { shape: "polygon", points: [[0, 0], [1, 1]] },
    { shape: "ellipse", center: [0, 0], radiusX: -1, radiusY: 10 },
    { shape: "path", points: [[0, 0]] },
    { shape: "arc", center: [0, 0], radius: 0 },
  ]);
  check("битые составные примитивы отбрасываются", badComposite.length === 0, `прошло ${badComposite.length}`);

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
  check(
    "isModelUnavailableError: 404 / model_decommissioned → снятая модель, 429 / сеть → нет",
    isModelUnavailableError(new AIProviderError("Groq: HTTP 404 — model_not_found", { status: 404 })) &&
      isModelUnavailableError(
        new AIProviderError("Groq: HTTP 400 — model_decommissioned, use openai/gpt-oss-120b", { status: 400 }),
      ) &&
      isModelUnavailableError(new AIProviderError("Gemini: HTTP 404 — NOT_FOUND", { status: 404 })) &&
      !isModelUnavailableError(new AIProviderError("Groq: HTTP 429 — rate limit", { status: 429 })) &&
      !isModelUnavailableError(new AIProviderError("Groq: сетевая ошибка", { retryable: true })),
  );

  console.log("5. GroqProvider (stub fetch)");
  const groqCalls: FetchCall[] = [];
  const groq = new GroqProvider({
    apiKey: "gsk_test",
    fetchImpl: stubFetch(chatResponse("## Конспект\n\nОтличный урок."), groqCalls),
  });
  const groqText = await groq.complete({ action: "summary", prompt: "Теорема Пифагора" });
  check("текстовый ответ распарсен", groqText.text.includes("Конспект"));
  check("providerId = groq", groqText.providerId === "groq");
  check("модель текста = openai/gpt-oss-120b", groqText.model === "openai/gpt-oss-120b", groqText.model ?? "");
  check("URL = api.groq.com", groqCalls[0]?.url.includes("api.groq.com/openai/v1/chat/completions") === true);

  const groqSolve = await groq.complete({ action: "solve", prompt: "x² − 5x + 6 = 0" });
  check("solve → reasoning-модель gpt-oss-120b", groqSolve.model === "openai/gpt-oss-120b", groqSolve.model ?? "");

  // Перебор моделей: снятый вендором ID не ломает запрос (fix 404 model_not_found).
  const groqChainCalls: string[] = [];
  const groqChain = new GroqProvider({
    apiKey: "gsk_test",
    fetchImpl: async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      groqChainCalls.push(String(body.model));
      if (groqChainCalls.length === 1) {
        return new Response(
          '{"error":{"message":"The model `openai/gpt-oss-120b` does not exist or you do not have access to it.","code":"model_not_found"}}',
          { status: 404 },
        );
      }
      return new Response(JSON.stringify(chatResponse("## Конспект по резервной модели")), { status: 200 });
    },
  });
  const chained = await groqChain.complete({ action: "summary", prompt: "Теорема Пифагора" });
  check(
    "404 первой модели → мгновенный переход ко второй",
    chained.model === GROQ_FALLBACK_MODELS[0] && groqChainCalls.length === 2,
    groqChainCalls.join(" → "),
  );
  const chainedAgain = await groqChain.complete({ action: "summary", prompt: "Теорема Пифагора" });
  check(
    "снятая модель запоминается и больше не опрашивается",
    chainedAgain.model === GROQ_FALLBACK_MODELS[0] && groqChainCalls.length === 3,
    groqChainCalls.join(" → "),
  );

  // 400 model_decommissioned — второе «лицо» той же проблемы у Groq.
  const groqDecomCalls: string[] = [];
  const groqDecom = new GroqProvider({
    apiKey: "gsk_test",
    fetchImpl: async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      groqDecomCalls.push(String(body.model));
      if (groqDecomCalls.length === 1) {
        return new Response(
          '{"error":{"message":"The model `openai/gpt-oss-120b` has been decommissioned and is no longer supported.","code":"model_decommissioned"}}',
          { status: 400 },
        );
      }
      return new Response(JSON.stringify(chatResponse("## Решение")), { status: 200 });
    },
  });
  const decomResult = await groqDecom.complete({ action: "solve", prompt: "x² − 5x + 6 = 0" });
  check(
    "400 model_decommissioned → перебор продолжается",
    decomResult.model === GROQ_FALLBACK_MODELS[0] && groqDecomCalls.length === 2,
    groqDecomCalls.join(" → "),
  );
  check(
    "список моделей Groq: живые ID первыми, legacy-ID из ТЗ сохранены",
    GROQ_FALLBACK_MODELS[0] === "openai/gpt-oss-20b" &&
      ["llama-3.3-70b-versatile", "llama3-70b-8192", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"].every(
        (model) => GROQ_FALLBACK_MODELS.includes(model),
      ),
  );

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

  // Groq Vision: снимок доски уходит в мультимодальную модель, а не «отказ».
  const groqVisionCalls: FetchCall[] = [];
  const groqVision = new GroqProvider({
    apiKey: "gsk_test",
    fetchImpl: stubFetch(
      chatResponse("## Что на доске\n\n2x + 3 = 7, x = 2.\n\n## Подробный разбор\n\nПереносим 3 вправо…"),
      groqVisionCalls,
    ),
  });
  const visionAnswer = await groqVision.complete({
    action: "ask",
    prompt: "Проанализируй доску",
    imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
  });
  check("изображение → Groq Vision (без отказа)", visionAnswer.providerId === "groq");
  check("Groq Vision вернул реальный разбор доски", /Что на доске/.test(visionAnswer.text), visionAnswer.text.slice(0, 60));
  const groqVisionBody = groqVisionCalls[0]?.body ?? {};
  check(
    "Groq Vision: модель llama-3.2-11b-vision-preview",
    groqVisionBody.model === GROQ_DEFAULT_VISION_MODEL,
    String(groqVisionBody.model),
  );
  check(
    "Groq Vision: изображение передано как image_url (data URL)",
    JSON.stringify(groqVisionBody).includes('"type":"image_url"') &&
      JSON.stringify(groqVisionBody).includes("data:image/png;base64,iVBORw0KGgo="),
  );
  check(
    "Groq Vision: текст строго по OpenAI Vision формату (board prompt + image_url)",
    GROQ_VISION_BOARD_PROMPT ===
      "Подробно проанализируй этот снимок школьной доски. Опиши рукописный текст, математические формулы, геометрию и решения:" &&
      JSON.stringify(groqVisionBody).includes(GROQ_VISION_BOARD_PROMPT),
  );
  check(
    "Groq Vision: системный промпт требует разбор снимка",
    JSON.stringify(groqVisionBody).includes("снимок классной доски"),
  );

  // Снятая vision-модель → мгновенный переход на 90b.
  const groqVisionChainModels: string[] = [];
  const groqVisionChain = new GroqProvider({
    apiKey: "gsk_test",
    fetchImpl: async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      groqVisionChainModels.push(String(body.model));
      if (groqVisionChainModels.length === 1) {
        return new Response(
          '{"error":{"message":"The model `llama-3.2-11b-vision-preview` does not exist or you do not have access to it.","code":"model_not_found"}}',
          { status: 404 },
        );
      }
      return new Response(JSON.stringify(chatResponse("## Что на доске\n\nРезервная vision-модель")), { status: 200 });
    },
  });
  const visionFallback = await groqVisionChain.complete({
    action: "ask",
    prompt: "Проанализируй доску",
    imageDataUrl: "data:image/png;base64,AAAA",
  });
  check(
    "Groq Vision: 404 → авто-переход на llama-3.2-90b-vision-preview",
    visionFallback.model === "llama-3.2-90b-vision-preview" && groqVisionChainModels.length === 2,
    groqVisionChainModels.join(" → "),
  );

  let rateLimited: unknown = null;
  let groq429Calls = 0;
  const groq429 = new GroqProvider({
    apiKey: "gsk_test",
    fetchImpl: async () => {
      groq429Calls += 1;
      return new Response("rate limit", { status: 429 });
    },
  });
  try {
    await groq429.complete({ action: "summary", prompt: "тест" });
  } catch (error) {
    rateLimited = error;
  }
  check("HTTP 429 → retryable-ошибка", rateLimited instanceof AIProviderError && rateLimited.retryable === true);
  check("429 (лимит, а не снятая модель) не запускает перебор моделей", groq429Calls === 1, `запросов: ${groq429Calls}`);
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
  check(
    "URL содержит :generateContent и модель по умолчанию",
    geminiUrl.includes(":generateContent") && geminiUrl.includes(GEMINI_DEFAULT_MODEL),
    geminiUrl,
  );
  check(
    "v1beta REST-URL с ключом в параметре key",
    geminiUrl === geminiGenerateContentUrl(GEMINI_DEFAULT_MODEL, "AIza_test"),
    geminiUrl,
  );
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
  check(
    `404 модели → авто-переключение на ${GEMINI_FALLBACK_MODELS[0]}`,
    requestIndex === 2 && fallbackResult.model === GEMINI_FALLBACK_MODELS[0],
    fallbackResult.model ?? "",
  );
  const fallbackAgain = await geminiFallback.complete({ action: "summary", prompt: "тема" });
  check(
    "снятая модель Gemini не опрашивается повторно",
    fallbackAgain.model === GEMINI_FALLBACK_MODELS[0] && requestIndex === 3,
    `запросов: ${requestIndex}`,
  );
  check(
    "список моделей Gemini: актуальные ID первыми, legacy-ID из ТЗ сохранены",
    GEMINI_FALLBACK_MODELS[0] === "gemini-3.6-flash" &&
      ["gemini-1.5-flash", "gemini-2.0-flash-exp", "gemini-1.5-pro"].every((model) => GEMINI_FALLBACK_MODELS.includes(model)),
  );
  check(
    "снятый gemini-1.5-flash-8b нормализуется в gemini-1.5-flash",
    resolveGeminiModel("gemini-1.5-flash-8b") === "gemini-1.5-flash" &&
      resolveGeminiModel("models/gemini-1.5-flash-8b") === "gemini-1.5-flash" &&
      resolveGeminiModel("gemini-1.5-flash") === "gemini-1.5-flash",
  );
  const geminiLegacy = new GeminiProvider({ apiKey: "AIza_test", model: "gemini-1.5-flash-8b" });
  check(
    "провайдер со старым GEMINI_MODEL ходит в API актуальным именем",
    geminiLegacy.model === "gemini-1.5-flash" &&
      geminiLegacy.modelsToTry()[0] === "gemini-1.5-flash" &&
      geminiGenerateContentUrl("gemini-1.5-flash-8b", "AIza_test").includes("/gemini-1.5-flash:generateContent"),
    geminiLegacy.model,
  );

  // Квота (429) — это не снятая модель: перебора нет, решает AutoAIProvider.
  let geminiQuotaCalls = 0;
  const geminiQuota = new GeminiProvider({
    apiKey: "AIza_test",
    fetchImpl: async () => {
      geminiQuotaCalls += 1;
      return new Response("quota exceeded", { status: 429 });
    },
  });
  let quotaError: unknown = null;
  try {
    await geminiQuota.complete({ action: "summary", prompt: "тема" });
  } catch (error) {
    quotaError = error;
  }
  check(
    "Gemini 429 → retryable-ошибка без перебора моделей",
    quotaError instanceof AIProviderError && geminiQuotaCalls === 1,
    `запросов: ${geminiQuotaCalls}`,
  );
  check("Gemini без ключа не создаётся", !GeminiProvider.isAvailable({} as NodeJS.ProcessEnv));

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

  // 8.3. Запрос с изображением доски — СРАЗУ Groq Vision (основной провайдер).
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
  check("изображение → первым вызван Groq Vision (Gemini пропущен)", log2[0] === "groq" && !log2.includes("gemini"), log2.join(","));

  // 8.3b. Groq Vision упал → снимок автоматически уходит в Gemini Vision.
  const log2b: string[] = [];
  const autoVisionGroq = new AutoAIProvider({
    env: {} as NodeJS.ProcessEnv,
    registry: {
      groq: recordingProvider("groq", log2b, true), // ошибка Groq Vision
      gemini: recordingProvider("gemini", log2b), // сработает Gemini Vision
      openrouter: recordingProvider("openrouter", log2b),
    },
  });
  const groqVisionAnswer = await autoVisionGroq.complete({
    action: "ask",
    prompt: "Проанализируй доску",
    imageDataUrl: "data:image/png;base64,AAAA",
  });
  check(
    "сбой Groq Vision → авто-переключение на Gemini Vision",
    log2b.join(",") === "groq,gemini" && groqVisionAnswer.providerId === "gemini",
    log2b.join(","),
  );
  check(
    "Vision-цепочка: Groq (основной) → Gemini → OpenRouter",
    VISION_CHAIN.join(",") === "groq,gemini,openrouter",
    VISION_CHAIN.join(","),
  );

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
  check("по умолчанию — STUN-пул Google + публичные TURN", defaultUrls.includes("stun:stun.l.google.com:19302") && defaultUrls.some((u) => u.startsWith("turn:")));
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
  const relay0 = getRelayIceServers(0, {} as NodeJS.ProcessEnv);
  check("relay-only стадия 0: только TURNS/TCP 443", relay0.length > 0 && relay0.every((s) => String(s.urls).startsWith("turns:") && String(s.urls).includes("transport=tcp")));
  const relayConfig = getRelayRtcConfiguration(1, {} as NodeJS.ProcessEnv);
  check("конфигурация звонка: relay-only", relayConfig.iceTransportPolicy === "relay" && (relayConfig.iceServers ?? []).every((s) => String(s.urls).startsWith("turn:")));
  const customRelay = getRelayIceServers(0, { NEXT_PUBLIC_TURN_SERVERS: '[{"urls":"turns:turn.school.ru:443?transport=tcp","username":"u","credential":"p"}]' } as NodeJS.ProcessEnv);
  check("свой TURN приоритетнее публичного", String(customRelay[0]?.urls).includes("turn.school.ru"));

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
