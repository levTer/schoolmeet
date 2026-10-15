/**
 * Groq Cloud — текстовый ИИ-движок Лицея Сингулярити (этап 8).
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
 * Ограничение: Groq не принимает изображения. Запрос с `imageDataUrl`
 * (распознавание формулы с доски) немедленно пробрасывает `AIProviderError`,
 * и `AutoAIProvider` переключается на Gemini Vision.
 */

import {
  AIProviderError,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  extractJsonObject,
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
    const primary = this.modelFor(action);
    const unique = [primary, ...GROQ_FALLBACK_MODELS].filter((model, index, all) => all.indexOf(model) === index);
    const alive = unique.filter((model) => !this.deadModels.has(model));
    return alive.length > 0 ? alive : [primary];
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    if (request.imageDataUrl) {
      // Текстовые модели Groq не принимают изображения — пусть AutoAIProvider
      // переключится на Gemini Vision.
      throw new AIProviderError("Groq не поддерживает изображения (нужен Gemini Vision)", { retryable: false });
    }

    const wantsJson = request.action === "draw";

    return this.runWithModelFallback(this.modelsFor(request.action), async (model) => {
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
            max_completion_tokens: wantsJson ? 3000 : 4096,
            ...(wantsJson ? { response_format: { type: "json_object" } } : {}),
            messages: [
              { role: "system", content: buildSystemPrompt(request.action, request.context?.meetingTitle, Boolean(request.imageDataUrl)) },
              { role: "user", content: buildUserPrompt(request) },
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
      const drawing = Array.isArray(json?.drawing) ? (json.drawing as AIResponse["drawing"]) : undefined;
      const text = typeof json?.text === "string" && json.text.trim() ? json.text.trim() : "## Чертёж по условию";
      if (!drawing || drawing.length === 0) {
        throw new AIProviderError("Groq: модель не вернула валидные инструкции черчения", { retryable: true });
      }
      return { ...base, text, drawing };
    }

    if (request.action === "formula") {
      // Без изображения Groq может лишь угадать формулу по тексту запроса —
      // возвращаем её как есть, AutoAIProvider до этого шага обычно не доходит.
      return { ...base, text: content, latex: content };
    }

    return { ...base, text: content };
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
