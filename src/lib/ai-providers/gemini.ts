/**
 * Google Gemini Flash — мультимодальный ИИ-движок SchoolMeet (этап 8).
 *
 * Gemini 2.0 / 1.5 Flash бесплатно (до 1 500 запросов/день, ключ без
 * привязки карты в AI Studio) и, главное, понимает ИЗОБРАЖЕНИЯ: именно он
 * распознаёт рукописные формулы с фрагмента интерактивной доски
 * (действие `formula` с `imageDataUrl`). Текстовые действия тоже
 * поддерживаются — Gemini стоит в конце текстовой цепочки фоллбэка.
 *
 * Вызовы — только через нативный `fetch`:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
 *   заголовок `x-goog-api-key` (ключ живёт ТОЛЬКО на сервере).
 *
 * Если модель из `GEMINI_MODEL` не найдена (404), провайдер автоматически
 * пробует запасные модели списка — API школы при этом не падает.
 */

import {
  AIProviderError,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  extractLatex,
  extractJsonObject,
  normalizeReviewDraft,
  parseDataUrl,
  postJson,
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

/** Базовый URL Gemini API (v1beta). */
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Модель по умолчанию — быстрая и мультимодальная. */
export const GEMINI_DEFAULT_MODEL = "gemini-2.0-flash";
/** Запасные модели: если основная недоступна в аккаунте (404). */
export const GEMINI_FALLBACK_MODELS = ["gemini-1.5-flash", "gemini-1.5-flash-8b"];

export interface GeminiProviderOptions {
  /** API-ключ; по умолчанию `process.env.GEMINI_API_KEY` (или `GOOGLE_API_KEY`). */
  apiKey?: string;
  /** Основная модель; по умолчанию `GEMINI_MODEL` или `gemini-2.0-flash`. */
  model?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/* -------------------------------------------------------------------------- */
/* Форматы Gemini API (нужные поля)                                            */
/* -------------------------------------------------------------------------- */

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

export class GeminiProvider implements AIProvider {
  readonly id = "gemini";
  readonly name = "Google Gemini Flash (Vision)";
  readonly isLocal = false;

  readonly model: string;

  private readonly apiKey: string;
  private readonly timeoutMs?: number;
  private readonly fetchImpl?: FetchLike;

  constructor(options: GeminiProviderOptions = {}) {
    this.apiKey = (options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "").trim();
    this.model = (options.model ?? process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL).trim() || GEMINI_DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl;

    if (!this.apiKey) {
      throw new AIProviderError("Gemini: отсутствует GEMINI_API_KEY", { retryable: false });
    }
  }

  static isAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean((env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "").trim());
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const parts: GeminiPart[] = [{ text: buildUserPrompt(request) }];

    if (request.imageDataUrl) {
      const image = parseDataUrl(request.imageDataUrl);
      if (!image) {
        throw new AIProviderError("Gemini: некорректный data URL изображения доски", { retryable: false });
      }
      parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
    }

    const wantsJson = request.action === "draw";
    const { text, model } = await this.generateContent({
      system: buildSystemPrompt(request.action, request.context?.meetingTitle, Boolean(request.imageDataUrl)),
      parts,
      jsonMode: wantsJson,
      temperature: wantsJson ? 0.3 : 0.4,
    });

    return this.parseResponse(request, text, model);
  }

  async reviewHomework(request: HomeworkReviewRequest): Promise<HomeworkReviewDraft> {
    const { text, model } = await this.generateContent({
      system: buildReviewSystemPrompt(request.maxScore),
      parts: [{ text: buildReviewUserPrompt(request) }],
      jsonMode: true,
      temperature: 0.2,
    });

    const draft = normalizeReviewDraft(extractJsonObject(text), request.maxScore);
    if (!draft) {
      throw new AIProviderError("Gemini: не удалось разобрать JSON черновика проверки", { retryable: false });
    }
    return { ...draft, providerId: this.id, model };
  }

  /* ------------------------------------------------------------------------ */
  /* Транспорт                                                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * generateContent с авто-перебором моделей: 404 (модель не найдена в
   * аккаунте) → пробуем следующую из `GEMINI_FALLBACK_MODELS`.
   */
  private async generateContent(options: {
    system: string;
    parts: GeminiPart[];
    jsonMode: boolean;
    temperature: number;
  }): Promise<{ text: string; model: string }> {
    const models = [this.model, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== this.model)];
    let lastError: unknown = null;

    for (const model of models) {
      try {
        const payload = await postJson(
          `${GEMINI_API_BASE}/${model}:generateContent`,
          {
            headers: { "x-goog-api-key": this.apiKey },
            provider: "Gemini",
            timeoutMs: this.timeoutMs,
            fetchImpl: this.fetchImpl,
            body: {
              systemInstruction: { parts: [{ text: options.system }] },
              contents: [{ role: "user", parts: options.parts }],
              generationConfig: {
                temperature: options.temperature,
                maxOutputTokens: options.jsonMode ? 3000 : 4096,
                ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
              },
            },
          },
        );
        return { text: readGeminiText(payload, model), model };
      } catch (error) {
        lastError = error;
        const notFound = error instanceof AIProviderError && error.status === 404;
        if (!notFound) throw error;
        console.warn(`[ai/gemini] модель ${model} недоступна (404), пробую следующую`);
      }
    }

    throw lastError ?? new AIProviderError("Gemini: все модели недоступны", { retryable: true });
  }

  /* ------------------------------------------------------------------------ */
  /* Разбор ответов                                                            */
  /* ------------------------------------------------------------------------ */

  private parseResponse(request: AIRequest, content: string, model: string): AIResponse {
    const base = { providerId: this.id, model };

    if (request.action === "formula") {
      const latex = extractLatex(content);
      if (!latex) {
        throw new AIProviderError("Gemini: формула на изображении не распознана", { retryable: true });
      }
      const title = request.context?.meetingTitle ? ` по уроку «${truncate(request.context.meetingTitle, 60)}»` : "";
      return {
        ...base,
        latex,
        text: `**Распознанная формула${title}:**\n\n\`\`\`latex\n${latex}\n\`\`\`\n\n### Формула распознана\n\nРукописный фрагмент доски заменён печатной формулой (Gemini Vision). Нажмите «Распознать формулу» ещё раз и выделите следующий фрагмент — так можно оцифровать всю доску.`,
      };
    }

    if (request.action === "draw") {
      const json = extractJsonObject(content);
      const drawing = Array.isArray(json?.drawing) ? (json.drawing as AIResponse["drawing"]) : undefined;
      const text = typeof json?.text === "string" && json.text.trim() ? json.text.trim() : "## Чертёж по условию";
      if (!drawing || drawing.length === 0) {
        throw new AIProviderError("Gemini: модель не вернула валидные инструкции черчения", { retryable: true });
      }
      return { ...base, text, drawing };
    }

    if (content.trim().length === 0) {
      throw new AIProviderError("Gemini: модель вернула пустой ответ", { retryable: true });
    }
    return { ...base, text: content };
  }
}

/** Склеивает текстовые parts первого кандидата; блокировки → ошибка. */
export function readGeminiText(payload: unknown, model: string): string {
  const data = payload as GeminiResponse | null;

  if (data?.error?.message) {
    throw new AIProviderError(`Gemini: API вернул ошибку — ${truncate(data.error.message, 200)}`, { retryable: true });
  }
  if (data?.promptFeedback?.blockReason) {
    throw new AIProviderError(`Gemini: запрос заблокирован (${data.promptFeedback.blockReason})`, { retryable: false });
  }

  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) {
    const reason = candidate?.finishReason ? ` (${candidate.finishReason})` : "";
    throw new AIProviderError(`Gemini[${model}]: пустой ответ модели${reason}`, { retryable: true });
  }
  return text;
}
