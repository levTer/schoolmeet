/**
 * Общие утилиты внешних ИИ-провайдеров Лицея Сингулярити (этап 8).
 *
 * Всё работает через нативный `fetch` (Node 18+/Vercel Runtime) — тяжёлые
 * сторонние SDK не используются. Здесь живут:
 *  - `AIProviderError` — типизированная ошибка провайдера (для waterfall-цепочки);
 *  - `postJson` — fetch с таймаутом через AbortController;
 *  - парсеры ответов: JSON-чертежи, LaTeX-формулы, черновики проверки ДЗ;
 *  - русскоязычные системные промпты для всех действий ИИ-помощника.
 *
 * Модуль серверный: не импортирует DOM и не содержит API-ключей в коде —
 * ключи читаются только из `process.env` в конструкторах провайдеров.
 */

import type {
  AIAction,
  AIRequest,
  HomeworkReviewDraft,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Ошибки                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Ошибка внешнего провайдера. `AutoAIProvider` ловит её и переключается
 * на следующего по цепочке — API `/api/ai` при этом не падает.
 */
export class AIProviderError extends Error {
  /** HTTP-статус ответа провайдера (если ошибка сетевая — undefined). */
  readonly status?: number;
  /**
   * `true` — имеет смысл повторить позже (429, 5xx, таймаут, сеть).
   * `false` — запрос в принципе не может быть выполнен этим провайдером
   * (нет ключа, модель не поддерживает изображения, 4xx).
   */
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = "AIProviderError";
    this.status = options.status;
    this.retryable = options.retryable ?? true;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  /** Ошибку можно пережить переключением на следующий провайдер цепочки. */
  static shouldFallback(error: unknown): boolean {
    if (error instanceof AIProviderError) return true;
    // Сетевые сбои fetch (TypeError: fetch failed), таймауты AbortError и т.п.
    return error instanceof Error;
  }
}

/**
 * Модель недоступна у провайдера: её сняли с обслуживания или переименовали.
 * Такая ошибка НЕ означает, что провайдер лежит, — поэтому провайдер обязан
 * мгновенно перебрать следующую модель своего списка и только потом сдаваться.
 *
 * Ловятся оба «лица» одной проблемы:
 *   • HTTP 404 (`model_not_found` у Groq, `NOT_FOUND` у Gemini) — модель
 *     удалена целиком;
 *   • HTTP 400 с кодом `model_decommissioned` — так Groq отвечает на модели,
 *     выведенные из эксплуатации (например `llama3-70b-8192`,
 *     `deepseek-r1-distill-llama-70b`, `llama-3.3-70b-versatile`).
 *
 * Прочие ошибки (429-лимит, 5xx, таймаут, сеть) НЕ считаются «снятой моделью»:
 * их перебор бессмыслен — управление уходит выше, в `AutoAIProvider`.
 */
export function isModelUnavailableError(error: unknown): boolean {
  if (!(error instanceof AIProviderError)) return false;
  if (error.status === 404 || error.status === 410) return true;
  if (error.status !== 400) return false;
  return /model_not_found|model_decommissioned|decommissioned|does not exist|no longer supported|unknown model/i.test(
    error.message,
  );
}

/* -------------------------------------------------------------------------- */
/* Нативный fetch с таймаутом                                                  */
/* -------------------------------------------------------------------------- */

/** Внедряемый fetch — удобство для unit-тестов без сети. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_AI_TIMEOUT_MS = 30_000;

export interface PostJsonOptions {
  headers: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** Имя провайдера для текстов ошибок. */
  provider: string;
}

/**
 * POST JSON через нативный fetch с жёстким таймаутом (AbortController).
 * Не-2xx превращает в `AIProviderError` с корректным флагом retryable:
 * 429/5xx — retryable, прочие 4xx — нет.
 */
export async function postJson(url: string, options: PostJsonOptions): Promise<unknown> {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((u, init) => fetch(u, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...options.headers },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new AIProviderError(
      aborted
        ? `${options.provider}: превышен таймаут ${timeoutMs} мс`
        : `${options.provider}: сетевая ошибка при обращении к API`,
      { retryable: true, cause: error },
    );
  } finally {
    clearTimeout(timer);
  }

  const rawText = await safeReadText(response);

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    const detail = truncate(rawText, 300) || response.statusText;
    throw new AIProviderError(`${options.provider}: HTTP ${response.status} — ${detail}`, {
      status: response.status,
      retryable,
    });
  }

  try {
    return JSON.parse(rawText) as unknown;
  } catch (error) {
    throw new AIProviderError(`${options.provider}: ответ не является JSON`, { retryable: false, cause: error });
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */
/* Парсеры ответов                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Достаёт первый JSON-объект из текста ответа модели: поддерживает и чистый
 * JSON, и markdown-обёртку ```json ... ```, и JSON с посторонним текстом
 * вокруг. Возвращает `null`, если распарсить не удалось.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const candidates: string[] = [];

  // 1. fenced-блок ```json ... ``` или ``` ... ```.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // 2. Первый сбалансированный {...} в тексте.
  const start = text.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }

  // 3. Весь текст как есть (модель могла вернуть чистый JSON).
  candidates.push(text.trim());

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // пробуем следующий кандидат
    }
  }
  return null;
}

/** Убирает «размышления» reasoning-моделей (DeepSeek R1: <think>…</think>). */
export function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "") // незакрытый тег в начале
    .trim();
}

/**
 * Извлекает LaTeX из ответа модели: из $$…$$, \[…\], ```latex-блока
 * или просто из текста, похожего на формулу.
 */
export function extractLatex(text: string): string {
  const cleaned = stripThinkTags(text).trim();

  const patterns: RegExp[] = [
    /```(?:latex|tex)\s*([\s\S]*?)```/i,
    /\$\$([\s\S]+?)\$\$/,
    /\\\[([\s\S]+?)\\\]/,
    /(?<!\\)\$([^$\n]+?)\$(?!\$)/,
    /\\\(([\s\S]+?)\\\)/,
    /```([\s\S]*?)```/,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  // Одна строка, похожая на формулу (есть = и LaTeX-команды/индексы).
  const firstLine = cleaned
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line.length < 400 && /=/.test(line) && /(\\[a-zA-Z]+|[_^])/.test(line));
  if (firstLine) return firstLine;

  return truncate(cleaned.replace(/\n{2,}/g, "\n"), 400);
}

/** Разбирает data URL изображения: `data:image/png;base64,AAAA` → части. */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

/**
 * Приводит сырой черновик проверки (JSON от модели) к `HomeworkReviewDraft`.
 * Оценка зажимается в [1, maxScore]; пустой комментарий заменяется запасным.
 */
export function normalizeReviewDraft(raw: unknown, maxScore: number): HomeworkReviewDraft | null {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  if (!record) return null;

  const grade = Number(record.suggestedGrade ?? record.grade ?? record.score);
  const comment = typeof record.draftComment === "string" ? record.draftComment : String(record.comment ?? "");
  if (!Number.isFinite(grade) || comment.trim().length === 0) return null;

  const suggestedGrade = Math.min(maxScore, Math.max(1, Math.round(grade)));
  return {
    suggestedGrade,
    draftComment: truncate(comment.trim(), 2000),
  };
}

export function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/* -------------------------------------------------------------------------- */
/* Системные промпты (русский язык, школьная специфика)                        */
/* -------------------------------------------------------------------------- */

/** Схема JSON-чертежа — ровно та, что валидирует `drawing-engine.ts`. */
const DRAWING_SCHEMA = `Схема JSON-чертежа (координаты в пикселях, холст примерно 1000×600, y растёт ВНИЗ):
{
  "text": "краткое пояснение в Markdown на русском",
  "drawing": [ ...фигуры... ]
}
Допустимые фигуры (каждый объект ОБЯЗАН содержать поле "shape"):
- {"shape":"triangle","points":[[x,y],[x,y],[x,y]]} — ровно 3 точки;
- {"shape":"circle","center":[x,y],"radius":r} — r > 0;
- {"shape":"line","from":[x,y],"to":[x,y]};
- {"shape":"rect","topLeft":[x,y],"width":w,"height":h} — w,h > 0;
- {"shape":"vector","from":[x,y],"to":[x,y]} — отрезок со стрелкой;
- {"shape":"graph","fn":"parabola"|"sine"|"linear"|"cubic","domain":[a,b],"origin":[x,y],"scale":s} — s > 0 (пикселей на единицу);
- {"shape":"point","at":[x,y]};
- {"shape":"text","at":[x,y],"text":"подпись","fontSize":22}.
Необязательные поля любой фигуры: "color" (CSS-цвет, например "#2563eb"), "strokeWidth" (число px), "label" (короткая подпись).
Правила: фигур не больше 12; все координаты — конечные числа в пределах холста; никаких других ключей и никакого текста вне JSON.`;

const ROLE_PREAMBLE =
  "Ты — ИИ-помощник учителя в российской школьной платформе видеоуроков «Лицей Сингулярити». " +
  "Отвечай СТРОГО на русском языке, точно и по делу, в формате Markdown. " +
  "Математические формулы записывай в LaTeX (\\(...\\) для строчных, $$...$$ для выносных).";

/**
 * Системный промпт под действие ИИ.
 *
 * `hasImage` — к запросу приложен снимок доски (кнопка «Передать доску»):
 * модель обязана опираться на то, что реально видно на доске.
 */
export function buildSystemPrompt(action: AIAction, meetingTitle?: string, hasImage = false): string {
  const lesson = meetingTitle?.trim() ? ` Текущий урок: «${truncate(meetingTitle.trim(), 120)}».` : "";
  const board = hasImage
    ? "\nВАЖНО: вместе с запросом приложен снимок классной доски — сначала разбери, что на нём написано (условия, выкладки, чертежи), и опирайся на это в ответе."
    : "";

  switch (action) {
    case "ask":
      return `${ROLE_PREAMBLE}${lesson}${board}
Задача: ответить на ЛЮБОЙ вопрос учителя — это может быть вопрос по теме урока, разбор уравнения, просьба объяснить правило, придумать задачу, составить план или проверить идею.
Формат ответа: Markdown. Сначала короткий прямой ответ, затем — при необходимости — пошаговое обоснование, примеры и формулы в LaTeX. Если вопрос требует вычислений, покажи шаги. Если данных в условии не хватает, задай один уточняющий вопрос и явно укажи сделанные допущения. Не отказывайся от вопроса: дай максимально полезный ответ по существу.`;

    case "summary":
      return `${ROLE_PREAMBLE}${lesson}
Задача: составить структурированный конспект по теме запроса.
Формат ответа: Markdown с заголовками «Основные понятия», «Ключевые формулы и правила», «Порядок решения типовой задачи», «Типичные ошибки». Формулы — в LaTeX. Объём — 150–350 слов, без воды.`;

    case "solve":
      return `${ROLE_PREAMBLE}${lesson}
Задача: решить задачу из запроса ПОШАГОВО, как у доски.
Формат ответа: Markdown-разделы «Дано», «Решение» (пронумерованные шаги с формулами в LaTeX и пояснениями), «Ответ» (выделен жирным). Проверь вычисления и размерности. Если условие неполное — реши типовую задачу по теме и явно укажи допущения.`;

    case "formulas":
      return `${ROLE_PREAMBLE}${lesson}
Задача: собрать справочник формул по теме запроса.
Формат ответа: Markdown-таблица «Формула (LaTeX) | Название | Условие применения», затем 2–4 коротких мнемонических правила. Только формулы темы, без длинных пояснений.`;

    case "check":
      return `${ROLE_PREAMBLE}${lesson}
Задача: проверить присланное решение задачи и указать на ошибки.
Формат ответа: Markdown: 1) вердикт (верно / ошибка в шаге N / требует доработки); 2) разбор по шагам с правильными выкладками в LaTeX; 3) типичные ошибки по теме; 4) итоговая рекомендация учителю. Будь тактичен: текст увидит школьник.`;

    case "draw":
      return `${ROLE_PREAMBLE}${lesson}
Задача: по условию задачи составить JSON-чертёж для автоматического рисования на школьной доске.
${DRAWING_SCHEMA}
Ответ — ТОЛЬКО один валидный JSON-объект по схеме, без markdown-обёртки и комментариев. Чертёж должен соответствовать условию: нужная фигура, подписи вершин, вспомогательные построения, векторы сил/скоростей для физики, оси и график для функций.`;

    case "formula":
      return `${ROLE_PREAMBLE}
Задача: распознать рукописную или нарисованную формулу на фрагменте школьной доски (изображение приложено) и перевести её в печатный LaTeX.
Ответ — ТОЛЬКО LaTeX-выражение формулы: без пояснений, без знаков $, без markdown. Если на фрагменте несколько формул — верни основную, остальные перечисли через перенос строки.`;

    default:
      return `${ROLE_PREAMBLE}${lesson} Ответь на запрос учителя кратко и структурированно.`;
  }
}

/** Пользовательская часть запроса (текст + контекст урока). */
export function buildUserPrompt(request: AIRequest): string {
  const lesson = request.context?.meetingTitle?.trim()
    ? `Контекст — урок: «${truncate(request.context.meetingTitle.trim(), 120)}».\n`
    : "";
  const prompt = request.prompt.trim() || "Сформулируй ответ по теме урока из контекста.";
  return `${lesson}Запрос учителя: ${truncate(prompt, 4000)}`;
}

/** Системный промпт черновика проверки ДЗ (JSON-режим). */
export function buildReviewSystemPrompt(maxScore: number): string {
  return `${ROLE_PREAMBLE}
Ты помогаешь учителю проверить домашнюю работу ученика. Это ЧЕРНОВИК: окончательную оценку всегда утверждает учитель.
Проанализируй условие задания и ответ ученика: полнота, верность выкладок, оформление, наличие промежуточных шагов.
Ответ — ТОЛЬКО один валидный JSON-объект:
{
  "suggestedGrade": <целое число от 1 до ${maxScore}>,
  "draftComment": "<развёрнутый комментарий для учителя на русском: что верно, что не так, что проверить вручную; 2–5 предложений>"
}
Если ответ пустой или не по теме — suggestedGrade: 1 и объясни это в комментарии.`;
}

/** Пользовательская часть запроса проверки ДЗ. */
export function buildReviewUserPrompt(request: {
  description: string;
  answer: string;
  maxScore: number;
  attachmentCount: number;
  isLate: boolean;
}): string {
  return [
    `Максимальный балл за работу: ${request.maxScore}.`,
    request.isLate ? "Работа сдана ПОСЛЕ дедлайна." : "Работа сдана в срок.",
    request.attachmentCount > 0 ? `К ответу приложено файлов: ${request.attachmentCount} (их содержимое недоступно — отметь это в комментарии).` : "",
    "",
    "УСЛОВИЕ ЗАДАНИЯ:",
    truncate(request.description.trim() || "(не заполнено)", 2500),
    "",
    "ОТВЕТ УЧЕНИКА:",
    truncate(request.answer.trim() || "(пусто)", 3500),
  ]
    .filter((line) => line !== "")
    .join("\n");
}
