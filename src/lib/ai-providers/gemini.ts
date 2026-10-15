/**
 * Google Gemini Flash — мультимодальный ИИ-движок Лицея Сингулярити (этап 8).
 *
 * Gemini Flash бесплатен в пределах дневной квоты (ключ без привязки карты в
 * AI Studio) и, главное, понимает ИЗОБРАЖЕНИЯ: именно он распознаёт
 * рукописные формулы с фрагмента интерактивной доски (действие `formula`
 * с `imageDataUrl`). Текстовые действия тоже поддерживаются — Gemini стоит
 * в конце текстовой цепочки фоллбэка.
 *
 * Вызовы — только через нативный `fetch`, официальный v1beta REST:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=<API_KEY>
 *
 * ПЕРЕБОР МОДЕЛЕЙ (исправление ошибок 404 `NOT_FOUND`): Google закрывает
 * старые поколения моделей (Gemini 1.5 — 29.09.2025, Gemini 2.0 — 01.06.2026;
 * см. ai.google.dev/gemini-api/docs/deprecations). Если модель из
 * `GEMINI_MODEL` не найдена, провайдер мгновенно, в том же вызове, пробует
 * следующую из `GEMINI_FALLBACK_MODELS`, а снятую запоминает, чтобы не
 * тратить на неё запросы в будущем. API школы при этом не падает.
 */

import {
  AIProviderError,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  extractLatex,
  extractJsonObject,
  isModelUnavailableError,
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

/** Базовый URL Gemini API (v1beta) — ключ передаётся параметром `key`. */
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Модель по умолчанию — самая свежая стабильная Flash-модель Google
 * (актуально на 12.10.2026): быстрая, мультимодальная (понимает изображения
 * доски) и доступна на бесплатном тарифе AI Studio.
 */
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";

/**
 * Резервные модели в порядке перебора (`generateContent`).
 *
 * Головная часть — актуальные на 12.10.2026 ID (ai.google.dev/gemini-api/docs/models):
 *  1. `gemini-3.6-flash`      — предыдущая стабильная Flash-линейка;
 *  2. `gemini-3.5-flash-lite` — самая быстрая и дешёвая 3.5-модель;
 *  3. `gemini-3.1-flash-lite` — frontier-качество при низкой цене;
 *  4. `gemini-2.5-flash` / `gemini-2.5-flash-lite` — для аккаунтов, созданных
 *     до 18.09.2026 (Google ограничил доступ к 2.5 новым проектам).
 *
 * Хвост — legacy-идентификаторы из исходного ТЗ. Google их уже выключил
 * (Gemini 1.5 — 29.09.2025, Gemini 2.0 — 01.06.2026, все запросы к ним
 * возвращают 404), поэтому они стоят в самом конце: если в аккаунте школы
 * они внезапно доступны — провайдер их задействует, но обычный запрос
 * до хвоста не доходит.
 */
export const GEMINI_FALLBACK_MODELS: readonly string[] = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash",
  "gemini-2.0-flash-exp",
  "gemini-1.5-pro",
];

/**
 * Снятые с обслуживания псевдонимы моделей → актуальные ID.
 *
 * `gemini-1.5-flash-8b` Google убрал из API v1beta: запросы к нему возвращают
 * 404 `models/gemini-1.5-flash-8b is not found for API version v1beta`.
 * Значение могло сохраниться в переменной окружения `GEMINI_MODEL` на хостинге,
 * поэтому провайдер нормализует его в `gemini-1.5-flash` до первого запроса.
 */
export const GEMINI_LEGACY_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "gemini-1.5-flash-8b": "gemini-1.5-flash",
};

/**
 * Нормализует имя модели Gemini: обрезает пробелы, снимает префикс `models/`
 * (полное имя ресурса в ответах Google) и отображает снятые псевдонимы
 * на актуальные ID.
 */
export function resolveGeminiModel(rawModel: string): string {
  const trimmed = rawModel.trim();
  const bare = trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
  return GEMINI_LEGACY_MODEL_ALIASES[bare] ?? bare;
}

/**
 * REST-URL вызова `generateContent` для модели: официальная схема v1beta
 * с ключом в параметре `key` (ключ формируется на сервере и в браузер не
 * попадает), например
 * `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=AIza…`.
 */
export function geminiGenerateContentUrl(model: string, apiKey: string): string {
  const resolved = resolveGeminiModel(model);
  return `${GEMINI_API_BASE}/${encodeURIComponent(resolved)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export interface GeminiProviderOptions {
  /** API-ключ; по умолчанию `process.env.GEMINI_API_KEY` (или `GOOGLE_API_KEY`). */
  apiKey?: string;
  /** Основная модель; по умолчанию `GEMINI_MODEL` или `gemini-3.8-flash`. */
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

  /**
   * Модели, ответившие 404 `NOT_FOUND`: Google снял их с обслуживания.
   * Повторно такие модели не опрашиваются — перебор сразу начинается с живой,
   * поэтому «мёртвый» ID стоит один лишний вызов за жизненный цикл инстанса.
   */
  private readonly deadModels = new Set<string>();

  constructor(options: GeminiProviderOptions = {}) {
    this.apiKey = (options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "").trim();
    this.model =
      resolveGeminiModel(options.model ?? process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL) || GEMINI_DEFAULT_MODEL;
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
   * Список моделей для перебора: основная (`GEMINI_MODEL` / `gemini-3.8-flash`),
   * затем резервные из `GEMINI_FALLBACK_MODELS` — без дублей и снятых моделей.
   *
   * Если живых не осталось, пробуем основную как последний шанс: окончательное
   * решение принимает Google API.
   */
  modelsToTry(): string[] {
    const unique = [this.model, ...GEMINI_FALLBACK_MODELS]
      .map((model) => resolveGeminiModel(model))
      .filter((model, index, all) => all.indexOf(model) === index);
    const alive = unique.filter((model) => !this.deadModels.has(model));
    return alive.length > 0 ? alive : [this.model];
  }

  /**
   * generateContent с мгновенным авто-перебором моделей: модель снята или
   * переименована (404 `NOT_FOUND`) → в том же вызове пробуем следующую из
   * `GEMINI_FALLBACK_MODELS`. Прочие ошибки (429-квота, 5xx, таймаут) не
   * перебираются — их обрабатывает `AutoAIProvider` переключением провайдера.
   */
  private async generateContent(options: {
    system: string;
    parts: GeminiPart[];
    jsonMode: boolean;
    temperature: number;
  }): Promise<{ text: string; model: string }> {
    let lastError: unknown = null;

    for (const model of this.modelsToTry()) {
      try {
        const payload = await postJson(
          geminiGenerateContentUrl(model, this.apiKey),
          {
            // Ключ уже передан параметром `key` в URL (официальная схема v1beta);
            // заголовок дублирует его — так надёжнее, если прокси режет query.
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
        if (!isModelUnavailableError(error)) throw error;
        lastError = error;
        this.deadModels.add(model);
        console.warn(`[ai/gemini] модель ${model} недоступна (404 NOT_FOUND) — мгновенно пробую следующую`);
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
