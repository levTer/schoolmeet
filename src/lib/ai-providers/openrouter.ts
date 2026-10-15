/**
 * OpenRouter — универсальный резервный ИИ-движок Лицея Сингулярити (этап 8).
 *
 * OpenRouter даёт доступ к сотням моделей, включая полностью бесплатные
 * (суффикс `:free`). В Лицее Сингулярити это среднее звено waterfall-цепочки:
 * если Groq исчерпал лимит или недоступен, запрос уходит сюда, и только
 * потом — в локальный Mock.
 *
 *   POST https://openrouter.ai/api/v1/chat/completions  (OpenAI-совместимый)
 *
 * Для запросов с изображением доски используется отдельная vision-модель
 * (`OPENROUTER_VISION_MODEL`), для текста — `OPENROUTER_MODEL`. Список
 * актуальных бесплатных моделей: https://openrouter.ai/models?q=free
 *
 * Ключ `OPENROUTER_API_KEY` хранится только на сервере.
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

/** API OpenRouter (OpenAI-совместимый). */
export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Текстовая :free-модель по умолчанию. */
export const OPENROUTER_DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
/** Vision-:free-модель по умолчанию (для распознавания формул с доски). */
export const OPENROUTER_DEFAULT_VISION_MODEL = "google/gemini-2.0-flash-exp:free";

export interface OpenRouterProviderOptions {
  apiKey?: string;
  /** Текстовая модель; по умолчанию `OPENROUTER_MODEL`. */
  model?: string;
  /** Vision-модель; по умолчанию `OPENROUTER_VISION_MODEL`. */
  visionModel?: string;
  /** HTTP-Referer для рейтинга OpenRouter; по умолчанию `NEXTAUTH_URL`. */
  referer?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string; code?: number };
}

export class OpenRouterProvider implements AIProvider {
  readonly id = "openrouter";
  readonly name = "OpenRouter (:free модели)";
  readonly isLocal = false;

  readonly model: string;
  readonly visionModel: string;

  private readonly apiKey: string;
  private readonly referer: string;
  private readonly timeoutMs?: number;
  private readonly fetchImpl?: FetchLike;

  constructor(options: OpenRouterProviderOptions = {}) {
    this.apiKey = (options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "").trim();
    this.model = (options.model ?? process.env.OPENROUTER_MODEL ?? OPENROUTER_DEFAULT_MODEL).trim() || OPENROUTER_DEFAULT_MODEL;
    this.visionModel =
      (options.visionModel ?? process.env.OPENROUTER_VISION_MODEL ?? OPENROUTER_DEFAULT_VISION_MODEL).trim() ||
      OPENROUTER_DEFAULT_VISION_MODEL;
    this.referer = (options.referer ?? process.env.NEXTAUTH_URL ?? "https://licey-singularity.local").trim();
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl;

    if (!this.apiKey) {
      throw new AIProviderError("OpenRouter: отсутствует OPENROUTER_API_KEY", { retryable: false });
    }
  }

  static isAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.OPENROUTER_API_KEY?.trim());
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const hasImage = Boolean(request.imageDataUrl);
    const model = hasImage ? this.visionModel : this.modelFor(request.action);
    const wantsJson = request.action === "draw";

    // OpenAI-совместимый формат: с изображением — content-массив с image_url.
    const userContent: unknown = hasImage
      ? [
          { type: "text", text: buildUserPrompt(request) },
          { type: "image_url", image_url: { url: request.imageDataUrl } },
        ]
      : buildUserPrompt(request);

    const payload = await postJson(
      OPENROUTER_API_URL,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          // Рекомендованные OpenRouter заголовки атрибуции.
          "HTTP-Referer": this.referer,
          "X-Title": "Singularity Lyceum",
        },
        provider: "OpenRouter",
        timeoutMs: this.timeoutMs,
        fetchImpl: this.fetchImpl,
        body: {
          model,
          temperature: wantsJson ? 0.3 : 0.4,
          max_tokens: wantsJson ? 3000 : 4096,
          ...(wantsJson ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: buildSystemPrompt(request.action, request.context?.meetingTitle, Boolean(request.imageDataUrl)) },
            { role: "user", content: userContent },
          ],
        },
      },
    );

    const content = stripThinkTags(readContent(payload));
    return this.parseResponse(request, content, model);
  }

  async reviewHomework(request: HomeworkReviewRequest): Promise<HomeworkReviewDraft> {
    const model = this.modelFor("check");

    const payload = await postJson(
      OPENROUTER_API_URL,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": this.referer,
          "X-Title": "Singularity Lyceum",
        },
        provider: "OpenRouter",
        timeoutMs: this.timeoutMs,
        fetchImpl: this.fetchImpl,
        body: {
          model,
          temperature: 0.2,
          max_tokens: 1200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildReviewSystemPrompt(request.maxScore) },
            { role: "user", content: buildReviewUserPrompt(request) },
          ],
        },
      },
    );

    const draft = normalizeReviewDraft(extractJsonObject(stripThinkTags(readContent(payload))), request.maxScore);
    if (!draft) {
      throw new AIProviderError("OpenRouter: не удалось разобрать JSON черновика проверки", { retryable: false });
    }
    return { ...draft, providerId: this.id, model };
  }

  /** Для математики (solve/check) — та же текстовая модель; можно задать свою через OPENROUTER_MODEL. */
  modelFor(action: AIRequest["action"]): string {
    void action;
    return this.model;
  }

  private parseResponse(request: AIRequest, content: string, model: string): AIResponse {
    if (content.trim().length === 0) {
      throw new AIProviderError("OpenRouter: модель вернула пустой ответ", { retryable: true });
    }

    const base = { providerId: this.id, model };

    if (request.action === "draw") {
      const json = extractJsonObject(content);
      const drawing = Array.isArray(json?.drawing) ? (json.drawing as AIResponse["drawing"]) : undefined;
      const text = typeof json?.text === "string" && json.text.trim() ? json.text.trim() : "## Чертёж по условию";
      if (!drawing || drawing.length === 0) {
        throw new AIProviderError("OpenRouter: модель не вернула валидные инструкции черчения", { retryable: true });
      }
      return { ...base, text, drawing };
    }

    if (request.action === "formula") {
      const latex = content.trim();
      return {
        ...base,
        latex,
        text: `**Распознанная формула:**\n\n\`\`\`latex\n${truncate(latex, 400)}\n\`\`\`\n\nФрагмент доски распознан через OpenRouter Vision.`,
      };
    }

    return { ...base, text: content };
  }
}

function readContent(payload: unknown): string {
  const data = payload as ChatCompletionResponse | null;
  if (data?.error?.message) {
    throw new AIProviderError(`OpenRouter: API вернул ошибку — ${truncate(data.error.message, 200)}`, {
      // 404 модели / исчерпанный дневной лимит :free — повод сменить провайдера.
      retryable: true,
    });
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new AIProviderError("OpenRouter: неожиданный формат ответа API", { retryable: true });
  }
  return content;
}
