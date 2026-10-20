/**
 * Groq Cloud — текстовый и мультимодальный (Vision) ИИ-движок Лицея Сингулярити.
 *
 * Самый быстрый в мире бесплатный LLM-инференс (LPU): GPT-OSS 120B / 20B для
 * конспектов, формул, чертежей, пошаговых решений и проверки задач.
 * Бесплатный тариф — 1 000 запросов на модель в сутки.
 *
 * Вызовы — только через нативный `fetch` к OpenAI-совместимому API:
 *   POST https://api.groq.com/openai/v1/chat/completions
 *
 * ПЕРЕБОР МОДЕЛЕЙ (исправление ошибок 404 `model_not_found`):
 * Groq регулярно снимает модели с обслуживания (см. `GROQ_FALLBACK_MODELS`
 * и console.groq.com/docs/deprecations). Если текущая модель больше не
 * существует, запрос НЕ падает: провайдер немедленно, в том же вызове,
 * пробует следующую из списка, а снятую запоминает, чтобы не тратить на неё
 * запросы в будущем. Если недоступны все модели списка — ошибка уходит в
 * `AutoAIProvider`, и запрос обслуживает OpenRouter / Gemini / Mock.
 *
 * Ключ `GROQ_API_KEY` читается из окружения СЕРВЕРА и никогда не отдаётся
 * в браузер. Из РФ API Groq напрямую недоступен — поэтому запросы идут
 * через сервер Vercel (Европа), и пользователям VPN не нужен.
 *
 * GROQ VISION (анализ снимка доски) — ОСНОВНОЙ Vision-провайдер SchoolMeet
 * (выбран, чтобы избежать региональных блокировок Google):
 * если к запросу приложен `imageDataUrl`, провайдер переключается на
 * мультимодальную модель `llama-3.2-11b-vision-preview` (резерв —
 * `llama-3.2-90b-vision-preview`) и отправляет изображение строго в
 * OpenAI Vision формате: сообщение `content` — массив из текстовой части
 * `GROQ_VISION_BOARD_PROMPT` и `{type:"image_url", image_url:{url}}`.
 * `AutoAIProvider` ставит Groq первым в `VISION_CHAIN`, поэтому при наличии
 * `GROQ_API_KEY` ответ с анализом доски приходит ВСЕГДА (далее по цепочке —
 * Gemini Vision → OpenRouter Vision → Mock только при сбое Groq).
 */

import {
  AIProviderError,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  drawingFromModelJson,
  extractJsonObject,
  extractLatex,
  splitDrawCommand,
  isModelUnavailableError,
  normalizeReviewDraft,
  postJson,
  stripThinkTags,
  truncate,
  type FetchLike,
} from "./shared";
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  HomeworkReviewDraft,
  HomeworkReviewRequest,
} from "./types";
import { AI_REASONING_ACTIONS } from "./types";

/** API Groq (OpenAI-совместимый chat completions). */
export const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Модель по умолчанию для текстовых действий.
 *
 * Актуально на 12.10.2026 (console.groq.com/docs/models): Groq перевёл
 * генерацию на семейство GPT-OSS, а прежние Llama/DeepSeek/Mixtral снял с
 * обслуживания. `openai/gpt-oss-120b` — флагман продакшн-линейки: 500 t/s,
 * 131k контекста, режим JSON и reasoning-возможности.
 */
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";

/**
 * Reasoning-модель по умолчанию (действия `solve` / `check`).
 *
 * `deepseek-r1-distill-llama-70b` (прежнее значение) снят Groq — его функции
 * выполняет `openai/gpt-oss-120b` с поддержкой `reasoning_effort`.
 */
export const GROQ_DEFAULT_REASONING_MODEL = "openai/gpt-oss-120b";

/**
 * Модель Groq Vision по умолчанию — распознавание снимка доски.
 *
 * `llama-3.2-11b-vision-preview` быстрее и дешевле, её хватает для рукописного
 * текста, формул и геометрии; при недоступности провайдер мгновенно
 * переключается на `llama-3.2-90b-vision-preview`.
 */
export const GROQ_DEFAULT_VISION_MODEL = "llama-3.2-11b-vision-preview";

/** Точный текст запроса к Groq Vision для анализа снимка школьной доски. */
export const GROQ_VISION_BOARD_PROMPT =
  "Подробно проанализируй этот снимок школьной доски. Опиши рукописный текст, математические формулы, геометрию и решения:";

/**
 * Резервные Vision-модели Groq — перебираются по очереди, если текущая
 * снята с обслуживания (404 `model_not_found` / `model_decommissioned`).
 */
export const GROQ_VISION_FALLBACK_MODELS: readonly string[] = [
  "llama-3.2-11b-vision-preview",
  "llama-3.2-90b-vision-preview",
];

/**
 * Резервные модели: их провайдер пробует по очереди, если текущая недоступна
 * (404 `model_not_found` или 400 `model_decommissioned`).
 *
 * Порядок — «от актуальных к резервным» (проверено 12.10.2026):
 *  1. `openai/gpt-oss-20b` — production, 1000 t/s, те же возможности, что у 120B;
 *  2. `qwen/qwen3.8-27b`   — preview, 131k контекста, thinking/JSON-режимы;
 *  3. legacy-хвост — идентификаторы из исходного ТЗ. Groq снял их безвозвратно
 *     (`llama-3.1-8b-instant` и `llama-3.3-70b-versatile` — 16.08.2026;
 *     `llama3-70b-8192`, `mixtral-8x7b-32768`, `gemma2-9b-it` — ранее), поэтому
 *     они оставлены в конце списка: если у аккаунта школы есть к ним доступ,
 *     провайдер их использует, но обычный запрос до хвоста не доходит.
 *
 * Число элементов не ограничено: перебор делает `runWithModelFallback`, а
 * снятые модели запоминаются в `deadModels` и больше не опрашиваются.
 */
export const GROQ_FALLBACK_MODELS: readonly string[] = [
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "llama-3.3-70b-versatile",
  "llama3-70b-8192",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
];

export interface GroqProviderOptions {
  /** API-ключ; по умолчанию `process.env.GROQ_API_KEY`. */
  apiKey?: string;
  /** Текстовая модель; по умолчанию `GROQ_MODEL` или `openai/gpt-oss-120b`. */
  model?: string;
  /** Reasoning-модель; по умолчанию `GROQ_REASONING_MODEL` или GPT-OSS 120B. */
  reasoningModel?: string;
  /** Vision-модель (анализ снимка доски); по умолчанию `GROQ_VISION_MODEL`. */
  visionModel?: string;
  timeoutMs?: number;
  /** Внедряемый fetch (для тестов без сети). */
  fetchImpl?: FetchLike;
}

/** Ответ OpenAI-совместимого chat/completions (нужные поля). */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

export class GroqProvider implements AIProvider {
  readonly id = "groq";
  readonly name = "Groq Cloud";
  readonly isLocal = false;

  readonly model: string;
  readonly reasoningModel: string;
  /** Мультимодальная модель для запросов со снимком доски. */
  readonly visionModel: string;

  private readonly apiKey: string;
  private readonly timeoutMs?: number;
  private readonly fetchImpl?: FetchLike;

  /**
   * Модели, которые уже ответили «не существует / снята» (404 или 400
   * `model_decommissioned`). Запросы к ним больше не отправляются: перебор
   * идёт сразу к живой модели, поэтому «мёртвый» ID стоит одну попытку за
   * весь жизненный цикл инстанса, а не на каждый запрос учителя.
   */
  private readonly deadModels = new Set<string>();

  constructor(options: GroqProviderOptions = {}) {
    this.apiKey = (options.apiKey ?? process.env.GROQ_API_KEY ?? "").trim();
    this.model = (options.model ?? process.env.GROQ_MODEL ?? GROQ_DEFAULT_MODEL).trim() || GROQ_DEFAULT_MODEL;
    this.reasoningModel =
      (options.reasoningModel ?? process.env.GROQ_REASONING_MODEL ?? GROQ_DEFAULT_REASONING_MODEL).trim() ||
      GROQ_DEFAULT_REASONING_MODEL;
    this.visionModel =
      (options.visionModel ?? process.env.GROQ_VISION_MODEL ?? GROQ_DEFAULT_VISION_MODEL).trim() ||
      GROQ_DEFAULT_VISION_MODEL;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl;

    if (!this.apiKey) {
      throw new AIProviderError("Groq: отсутствует GROQ_API_KEY", { retryable: false });
    }
  }

  /** Доступен ли провайдер в текущем окружении (ключ задан). */
  static isAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.GROQ_API_KEY?.trim());
  }

  /** Какую модель использовать для действия. */
  modelFor(action: AIRequest["action"]): string {
    return AI_REASONING_ACTIONS.includes(action) ? this.reasoningModel : this.model;
  }

  /**
   * Список моделей для перебора под конкретное действие: сначала модель
   * действия (текстовая или reasoning), затем резервные из
   * `GROQ_FALLBACK_MODELS` — без дублей и уже снятых моделей.
   *
   * Если «живых» не осталось вовсе (все вычеркнуты `deadModels`), возвращаем
   * основную модель как последний шанс: окончательное решение — за API Groq.
   */
  modelsFor(action: AIRequest["action"]): string[] {
    return this.aliveModels(this.modelFor(action), GROQ_FALLBACK_MODELS);
  }

  /**
   * Список Vision-моделей для запроса со снимком доски: настроенная
   * `GROQ_VISION_MODEL` (или `llama-3.2-11b-vision-preview`), затем
   * `GROQ_VISION_FALLBACK_MODELS` — без дублей и снятых моделей.
   */
  visionModels(): string[] {
    return this.aliveModels(this.visionModel, GROQ_VISION_FALLBACK_MODELS);
  }

  /** Уникальные «живые» модели: primary → резервные, минус снятые вендором. */
  private aliveModels(primary: string, fallbacks: readonly string[]): string[] {
    const unique = [primary, ...fallbacks].filter((model, index, all) => all.indexOf(model) === index);
    const alive = unique.filter((model) => !this.deadModels.has(model));
    return alive.length > 0 ? alive : [primary];
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    // Снимок доски → мультимодальные модели Groq Vision (image_url + base64).
    const hasImage = Boolean(request.imageDataUrl);
    const wantsJson = request.action === "draw";
    const models = hasImage ? this.visionModels() : this.modelsFor(request.action);

    return this.runWithModelFallback(models, async (model) => {
      const payload = await postJson(
        GROQ_API_URL,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          provider: "Groq",
          timeoutMs: this.timeoutMs,
          fetchImpl: this.fetchImpl,
          body: {
            model,
            temperature: request.action === "draw" ? 0.3 : 0.4,
            // Vision-модели Groq (llama-3.2-vision-preview) принимают max_tokens;
            // новые текстовые модели — max_completion_tokens.
            ...(hasImage
              ? { max_tokens: 4096 }
              : { max_completion_tokens: wantsJson ? 3000 : 4096 }),
            // JSON-режим поддерживают текстовые модели; у vision-preview его нет.
            ...(wantsJson && !hasImage ? { response_format: { type: "json_object" } } : {}),
            messages: [
              {
                role: "system",
                content: buildSystemPrompt(request.action, request.context?.meetingTitle, hasImage),
              },
              {
                role: "user",
                content: hasImage
                  ? [
                      {
                        type: "text",
                        text: request.prompt.trim()
                          ? `${GROQ_VISION_BOARD_PROMPT}\nЗапрос учителя: ${request.prompt.trim()}`
                          : GROQ_VISION_BOARD_PROMPT,
                      },
                      { type: "image_url", image_url: { url: request.imageDataUrl } },
                    ]
                  : buildUserPrompt(request),
              },
            ],
          },
        },
      );

      const content = readChatContent(payload, "Groq");
      return this.parseResponse(request, stripThinkTags(content), model);
    });
  }

  async reviewHomework(request: HomeworkReviewRequest): Promise<HomeworkReviewDraft> {
    // Проверка ДЗ — обычный текстовый запрос, поэтому идём по текстовым моделям.
    return this.runWithModelFallback(this.modelsFor("summary"), async (model) => {
      const payload = await postJson(
        GROQ_API_URL,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          provider: "Groq",
          timeoutMs: this.timeoutMs,
          fetchImpl: this.fetchImpl,
          body: {
            model,
            temperature: 0.2,
            max_completion_tokens: 1200,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: buildReviewSystemPrompt(request.maxScore) },
              { role: "user", content: buildReviewUserPrompt(request) },
            ],
          },
        },
      );

      const content = readChatContent(payload, "Groq");
      const draft = normalizeReviewDraft(extractJsonObject(stripThinkTags(content)), request.maxScore);
      if (!draft) {
        throw new AIProviderError("Groq: не удалось разобрать JSON черновика проверки", { retryable: false });
      }
      return { ...draft, providerId: this.id, model };
    });
  }

  /**
   * Мгновенный перебор моделей внутри одного вызова.
   *
   * «Модель снята / не существует» (404 `model_not_found`, 400
   * `model_decommissioned`) → помечаем её мёртвой и тут же повторяем запрос
   * со следующей моделью списка. Любая другая ошибка (429-лимит, 5xx,
   * таймаут, сеть) не перебирается: она означает недоступность самого Groq,
   * и решение принимает `AutoAIProvider`, переключаясь на другого провайдера.
   */
  private async runWithModelFallback<T>(models: string[], call: (model: string) => Promise<T>): Promise<T> {
    let lastError: unknown = null;

    for (const model of models) {
      try {
        return await call(model);
      } catch (error) {
        if (!isModelUnavailableError(error)) throw error;
        lastError = error;
        this.deadModels.add(model);
        console.warn(`[ai/groq] модель ${model} недоступна (снята или переименована) — мгновенно пробую следующую`);
      }
    }

    throw lastError ?? new AIProviderError("Groq: все модели недоступны", { retryable: true });
  }

  /** Разбор текстового ответа модели под контракт `AIResponse`. */
  private parseResponse(request: AIRequest, content: string, model: string): AIResponse {
    if (content.trim().length === 0) {
      throw new AIProviderError("Groq: модель вернула пустой ответ", { retryable: true });
    }

    const base = { providerId: this.id, model };

    if (request.action === "draw") {
      const json = extractJsonObject(content);
      const drawing = drawingFromModelJson(json);
      const text = typeof json?.text === "string" && json.text.trim() ? json.text.trim() : "## Чертёж по условию";
      if (!drawing || drawing.length === 0) {
        throw new AIProviderError("Groq: модель не вернула валидные инструкции черчения", { retryable: true });
      }
      return { ...base, text, drawing };
    }

    if (request.action === "formula") {
      // Фрагмент доски распознан Groq Vision: вытаскиваем LaTeX из ответа
      // (модель может обернуть его в ```latex или $...$) и показываем учителю
      // человекочитаемый разбор, а не сырой ответ модели.
      const latex = extractLatex(content) ?? content.trim();
      return {
        ...base,
        latex,
        text: request.imageDataUrl
          ? `**Распознанная формула:**\n\n\`\`\`latex\n${latex}\n\`\`\`\n\n### Формула распознана\n\nСнимок доски обработан Groq Vision (${model}). Нажмите «Распознать формулу» ещё раз и выделите следующий фрагмент — так можно оцифровать всю доску.`
          : content,
      };
    }

    // Команда рисования {"action":"draw",…} в свободном ответе → `drawing` + чистый текст.
    const split = splitDrawCommand(content);
    return { ...base, text: split.text, ...(split.drawing ? { drawing: split.drawing } : {}) };
  }
}

/** Достаёт текст первого choice из OpenAI-совместимого ответа. */
export function readChatContent(payload: unknown, provider: string): string {
  const data = payload as ChatCompletionResponse | null;
  if (data?.error?.message) {
    throw new AIProviderError(`${provider}: API вернул ошибку — ${truncate(data.error.message, 200)}`, {
      retryable: false,
    });
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new AIProviderError(`${provider}: неожиданный формат ответа API`, { retryable: true });
  }
  return content;
}
