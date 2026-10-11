/**
 * Groq Cloud — текстовый ИИ-движок SchoolMeet (этап 8).
 *
 * Самый быстрый в мире бесплатный LLM-инференс (LPU): Llama 3.3 70B для
 * конспектов/формул/чертежей и DeepSeek R1 Distill Llama 70B для пошагового
 * решения и проверки задач. Бесплатный лимит — до 14 400 запросов/день.
 *
 * Вызовы — только через нативный `fetch` к OpenAI-совместимому API:
 *   POST https://api.groq.com/openai/v1/chat/completions
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

/** Модель по умолчанию для текстовых действий. */
export const GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile";
/** Reasoning-модель по умолчанию (solve / check). */
export const GROQ_DEFAULT_REASONING_MODEL = "deepseek-r1-distill-llama-70b";

export interface GroqProviderOptions {
  /** API-ключ; по умолчанию `process.env.GROQ_API_KEY`. */
  apiKey?: string;
  /** Текстовая модель; по умолчанию `GROQ_MODEL` или `llama-3.3-70b-versatile`. */
  model?: string;
  /** Reasoning-модель; по умолчанию `GROQ_REASONING_MODEL` или DeepSeek R1 Distill. */
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

  async complete(request: AIRequest): Promise<AIResponse> {
    if (request.imageDataUrl) {
      // Текстовые модели Groq не принимают изображения — пусть AutoAIProvider
      // переключится на Gemini Vision.
      throw new AIProviderError("Groq не поддерживает изображения (нужен Gemini Vision)", { retryable: false });
    }

    const model = this.modelFor(request.action);
    const wantsJson = request.action === "draw";

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
  }

  async reviewHomework(request: HomeworkReviewRequest): Promise<HomeworkReviewDraft> {
    const model = this.model;

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
