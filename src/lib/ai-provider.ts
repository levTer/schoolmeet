/**
 * ИИ-движок Лицея Сингулярити (этап 8): контракт, авто-выбор провайдера и
 * waterfall-фоллбэк.
 *
 * АРХИТЕКТУРА «ИИ В РФ БЕЗ VPN»:
 * Все вызовы внешних нейросетей выполняются ТОЛЬКО на сервере — в роуте
 * `/api/ai` (Vercel, регион Европа). Сервер выступает прокси-посредником:
 * браузер учителя в РФ обращается к своему домену школы, а уже Vercel
 * разговаривает с Groq / Gemini / OpenRouter. API-ключи никогда не попадают
 * в клиентский бандл.
 *
 * ЦЕПОЧКА АВТО-ВЫБОРА (AutoAIProvider):
 *   • запрос с изображением доски (распознавание формулы)
 *       → Gemini Vision → OpenRouter Vision → Mock;
 *   • текстовый запрос (конспект, решение, чертёж, проверка ДЗ)
 *       → Groq (gpt-oss-120b/20b, бесплатный тариф) → OpenRouter :free
 *       → Gemini Flash → Mock;
 *   • провайдер без ключа или с ошибкой (лимит, сеть, 5xx) — автоматически
 *     пропускается, API школы не падает НИКОГДА: последнее звено Mock
 *     работает полностью локально.
 *
 * ВНУТРИ ПРОВАЙДЕРА МОДЕЛИ ТОЖЕ ПЕРЕБИРАЮТСЯ: если вендор снял модель с
 * обслуживания (404 `model_not_found` / `NOT_FOUND`, 400
 * `model_decommissioned`), запрос в том же вызове уходит на следующую модель
 * списка, а школа этого не замечает.
 *
 * Принудительный выбор одного провайдера — переменная `AI_PROVIDER`
 * (`groq` | `gemini` | `openrouter` | `mock` | `auto`, по умолчанию `auto`).
 *
 * БЕЗОПАСНОСТЬ: ИИ доступен строго ролям TEACHER и ADMIN — проверку
 * выполняет `/api/ai` (ученик получает 403 Forbidden), UI-панель для
 * учеников не рендерится.
 *
 * Модуль не зависит от Next.js и DOM: его импортируют серверный роут
 * `/api/ai`, `src/lib/homework.ts` и клиентские компоненты (типы).
 */

/* -------------------------------------------------------------------------- */
/* Контракт — единая точка экспорта (обратная совместимость импортов)          */
/* -------------------------------------------------------------------------- */

export * from "./ai-providers/types";
export { MockAIProvider } from "./ai-providers/mock";
export {
  GroqProvider,
  GROQ_API_URL,
  GROQ_DEFAULT_MODEL,
  GROQ_DEFAULT_REASONING_MODEL,
  GROQ_FALLBACK_MODELS,
} from "./ai-providers/groq";
export {
  GeminiProvider,
  GEMINI_API_BASE,
  GEMINI_DEFAULT_MODEL,
  GEMINI_FALLBACK_MODELS,
  GEMINI_LEGACY_MODEL_ALIASES,
  geminiGenerateContentUrl,
  resolveGeminiModel,
} from "./ai-providers/gemini";
export {
  OpenRouterProvider,
  OPENROUTER_API_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_VISION_MODEL,
} from "./ai-providers/openrouter";
export { AIProviderError, isModelUnavailableError } from "./ai-providers/shared";

import { GeminiProvider } from "./ai-providers/gemini";
import { GroqProvider } from "./ai-providers/groq";
import { MockAIProvider } from "./ai-providers/mock";
import { OpenRouterProvider } from "./ai-providers/openrouter";
import type {
  AIProvider,
  AIProviderInfo,
  AIProviderStatus,
  AIRequest,
  AIResponse,
  HomeworkReviewDraft,
  HomeworkReviewRequest,
} from "./ai-providers/types";

/* -------------------------------------------------------------------------- */
/* AutoAIProvider — умная цепочка авто-выбора и переключения                   */
/* -------------------------------------------------------------------------- */

/** Идентификаторы сетевых провайдеров в порядке регистрации. */
export type ExternalProviderId = "groq" | "gemini" | "openrouter";

/** Цепочка фоллбэка для текстовых запросов (задача, конспект, чертёж, ДЗ). */
export const TEXT_CHAIN: readonly ExternalProviderId[] = ["groq", "openrouter", "gemini"];
/** Цепочка фоллбэка для запросов с изображением доски (Vision). */
export const VISION_CHAIN: readonly ExternalProviderId[] = ["gemini", "openrouter"];

export interface AutoAIProviderOptions {
  /** Таблица переменных окружения (по умолчанию `process.env`) — для тестов. */
  env?: NodeJS.ProcessEnv;
  /**
   * Готовые экземпляры провайдеров (внедрение зависимостей для тестов).
   * Отсутствующие будут созданы из `env`, если заданы ключи.
   */
  registry?: Partial<Record<ExternalProviderId | "mock", AIProvider>>;
}

interface ResolvedRegistry {
  groq?: AIProvider;
  gemini?: AIProvider;
  openrouter?: AIProvider;
  mock: AIProvider;
}

/**
 * Провайдер-оркестратор: на каждый запрос строит цепочку кандидатов
 * (Vision — если приложено изображение доски, иначе текстовую) и передаёт
 * запрос первому доступному. Ошибка любого звена — переключение на следующее.
 * Цепочка всегда заканчивается локальным Mock, поэтому `complete()` и
 * `reviewHomework()` не бросают исключений при живом модуле.
 */
export class AutoAIProvider implements AIProvider {
  readonly id = "auto";
  readonly name: string;

  private readonly env: NodeJS.ProcessEnv;
  private readonly registry: ResolvedRegistry;
  private readonly forced: ExternalProviderId | "mock" | null;

  constructor(options: AutoAIProviderOptions = {}) {
    this.env = options.env ?? process.env;

    const forcedRaw = (this.env.AI_PROVIDER ?? "auto").trim().toLowerCase();
    this.forced =
      forcedRaw === "groq" || forcedRaw === "gemini" || forcedRaw === "openrouter" || forcedRaw === "mock"
        ? forcedRaw
        : null;

    this.registry = {
      groq: options.registry?.groq ?? this.tryCreate("groq"),
      gemini: options.registry?.gemini ?? this.tryCreate("gemini"),
      openrouter: options.registry?.openrouter ?? this.tryCreate("openrouter"),
      mock: options.registry?.mock ?? new MockAIProvider(),
    };

    this.name = this.buildName();
  }

  /**
   * `true`, когда внешних ключей нет (или выбран `mock`) и все ответы
   * готовятся локально — UI показывает «локальный режим».
   */
  get isLocal(): boolean {
    if (this.forced === "mock") return true;
    // Принудительный внешний провайдер без ключа → фактически работает Mock.
    if (this.forced) return !this.registry[this.forced];
    return !this.registry.groq && !this.registry.gemini && !this.registry.openrouter;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const chain = this.chainFor(request);
    return this.runChain(chain, (provider) => provider.complete(request), "complete");
  }

  async reviewHomework(request: HomeworkReviewRequest): Promise<HomeworkReviewDraft> {
    // Проверка ДЗ — всегда текстовый запрос.
    const chain = this.chainFor({ action: "check", prompt: "" });
    return this.runChain(chain, (provider) => provider.reviewHomework(request), "reviewHomework");
  }

  /** Диагностика для GET /api/ai: какие провайдеры подключены и в каком порядке. */
  getStatuses(): AIProviderStatus[] {
    const describe = (
      id: ExternalProviderId | "mock",
      provider: AIProvider | undefined,
      model: string,
      textPriority: number | null,
      visionPriority: number | null,
      reason?: string,
    ): AIProviderStatus => ({
      id,
      name: provider?.name ?? id,
      model,
      available: Boolean(provider),
      reason: provider ? undefined : reason ?? "API-ключ не задан",
      textPriority,
      visionPriority,
    });

    const textIndex = (id: ExternalProviderId): number | null =>
      this.forced === id ? 0 : this.forced ? null : TEXT_CHAIN.indexOf(id) >= 0 ? TEXT_CHAIN.indexOf(id) : null;
    const visionIndex = (id: ExternalProviderId): number | null =>
      this.forced === id ? 0 : this.forced ? null : VISION_CHAIN.indexOf(id) >= 0 ? VISION_CHAIN.indexOf(id) : null;

    return [
      describe("groq", this.registry.groq, this.modelOf("groq"), textIndex("groq"), visionIndex("groq"),
        this.registry.groq ? undefined : "нет GROQ_API_KEY (console.groq.com — бесплатный тариф: openai/gpt-oss-120b)"),
      describe("gemini", this.registry.gemini, this.modelOf("gemini"), textIndex("gemini"), visionIndex("gemini"),
        this.registry.gemini ? undefined : "нет GEMINI_API_KEY (aistudio.google.com — бесплатно, без карты)"),
      describe("openrouter", this.registry.openrouter, this.modelOf("openrouter"), textIndex("openrouter"), visionIndex("openrouter"),
        this.registry.openrouter ? undefined : "нет OPENROUTER_API_KEY (openrouter.ai — :free модели)"),
      {
        id: "mock",
        name: "MockAI (локальный режим)",
        model: "локальные шаблоны",
        available: true,
        textPriority: TEXT_CHAIN.length,
        visionPriority: VISION_CHAIN.length,
      },
    ];
  }

  /* ------------------------------------------------------------------------ */
  /* Внутренняя механика                                                       */
  /* ------------------------------------------------------------------------ */

  /** Цепочка провайдеров под конкретный запрос (всегда заканчивается Mock). */
  private chainFor(request: AIRequest): AIProvider[] {
    if (this.forced === "mock") return [this.registry.mock];

    // После ветки выше `forced` — внешний провайдер или null.
    const ids: readonly ExternalProviderId[] = this.forced
      ? [this.forced]
      : request.imageDataUrl
        ? VISION_CHAIN
        : TEXT_CHAIN;

    const chain = ids
      .map((id) => this.registry[id])
      .filter((provider): provider is AIProvider => Boolean(provider));

    // Mock — гарантированный последний рубеж (без него цепочка могла бы опустеть).
    chain.push(this.registry.mock);
    return chain;
  }

  private async runChain<T>(
    chain: AIProvider[],
    invoke: (provider: AIProvider) => Promise<T>,
    operation: string,
  ): Promise<T> {
    let lastError: unknown = null;

    for (const provider of chain) {
      try {
        const result = await invoke(provider);
        this.logSuccess(provider, operation);
        return result;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[ai-auto] ${operation}: провайдер "${provider.id}" не ответил (${message}) — переключение`);
      }
    }

    // Недостижимо при живой цепочке (Mock не бросает исключений), но контракт
    // требует возврата — сообщаем о последней ошибке.
    throw lastError ?? new Error("ИИ-движок: цепочка провайдеров пуста");
  }

  private logSuccess(provider: AIProvider, operation: string): void {
    if (!provider.isLocal) {
      console.info(`[ai-auto] ${operation}: ответил "${provider.id}"`);
    }
  }

  private tryCreate(id: ExternalProviderId): AIProvider | undefined {
    try {
      // Общий таймаут внешнего вызова (AI_TIMEOUT_MS), если задан.
      const timeoutRaw = Number(this.env.AI_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined;

      switch (id) {
        case "groq":
          return GroqProvider.isAvailable(this.env)
            ? new GroqProvider({ apiKey: this.env.GROQ_API_KEY, timeoutMs })
            : undefined;
        case "gemini":
          return GeminiProvider.isAvailable(this.env)
            ? new GeminiProvider({
                apiKey: this.env.GEMINI_API_KEY ?? this.env.GOOGLE_API_KEY,
                model: this.env.GEMINI_MODEL,
                timeoutMs,
              })
            : undefined;
        case "openrouter":
          return OpenRouterProvider.isAvailable(this.env)
            ? new OpenRouterProvider({ apiKey: this.env.OPENROUTER_API_KEY, timeoutMs })
            : undefined;
      }
    } catch (error) {
      console.warn(`[ai-auto] провайдер "${id}" не инициализирован:`, error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  private modelOf(id: ExternalProviderId): string {
    const provider = this.registry[id];
    if (!provider) return "—";
    if (provider instanceof GroqProvider) return `${provider.model} / ${provider.reasoningModel}`;
    if (provider instanceof GeminiProvider) return provider.model;
    if (provider instanceof OpenRouterProvider) return `${provider.model} / vision: ${provider.visionModel}`;
    return "—";
  }

  private buildName(): string {
    if (this.forced === "mock") return "MockAI (локальный режим)";
    if (this.forced) {
      const provider = this.registry[this.forced];
      return provider ? `${provider.name} (принудительно)` : `${this.forced} (недоступен — резерв Mock)`;
    }
    const active = [this.registry.groq, this.registry.gemini, this.registry.openrouter].filter(Boolean);
    if (active.length === 0) return "MockAI (локальный режим)";
    const names = active.map((provider) => provider?.name.replace(/ \(.*\)$/, "")).join(" + ");
    return `AutoAI: ${names}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Провайдер по умолчанию                                                      */
/* -------------------------------------------------------------------------- */

let provider: AIProvider | null = null;

/**
 * Текущий провайдер ИИ: `AutoAIProvider` (waterfall Groq → OpenRouter →
 * Gemini → Mock; для изображений — Gemini Vision → OpenRouter Vision → Mock).
 * Создаётся лениво при первом обращении, чтобы окружение успело загрузиться.
 */
export function getAIProvider(): AIProvider {
  if (!provider) provider = new AutoAIProvider();
  return provider;
}

/** Замена провайдера (для тестов и нестандартных конфигураций). */
export function setAIProvider(next: AIProvider | null): void {
  provider = next;
}

/** Диагностика подключённых провайдеров (для GET /api/ai и админ-отладки). */
export function getAIProvidersStatus(): { provider: AIProviderInfo; statuses: AIProviderStatus[] } {
  const current = getAIProvider();
  const statuses = current instanceof AutoAIProvider ? current.getStatuses() : [];
  return {
    provider: {
      id: current.id,
      name: current.name,
      isLocal: current.isLocal,
    },
    statuses,
  };
}

/* -------------------------------------------------------------------------- */
/* Утилиты вывода                                                              */
/* -------------------------------------------------------------------------- */

const LATEX_COMMANDS: Array<[RegExp, string]> = [
  [/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)"],
  [/\\sqrt\s*\{([^{}]*)\}/g, "√($1)"],
  [/\\pm/g, "±"],
  [/\\cdot/g, "·"],
  [/\\times/g, "×"],
  [/\\leq/g, "≤"],
  [/\\geq/g, "≥"],
  [/\\neq/g, "≠"],
  [/\\alpha/g, "α"],
  [/\\beta/g, "β"],
  [/\\gamma/g, "γ"],
  [/\\pi/g, "π"],
  [/\\Delta/g, "Δ"],
  [/\\sum/g, "Σ"],
  [/\\,/g, " "],
];

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
};

/**
 * Превращает простой LaTeX в читаемый текст для печати на доске:
 * `x = \frac{-b \pm \sqrt{D}}{2a}` → `x = (−b ± √(D))/(2a)`.
 *
 * Полноценный LaTeX на канве недоступен без сторонних библиотек, поэтому
 * «печатный текст с формулой» собирается из Unicode-символов.
 */
export function latexToReadableText(latex: string): string {
  let text = latex;

  // Верхние индексы вида ^{...} и ^2.
  text = text.replace(/\^\{([^{}]*)\}/g, (_, body: string) =>
    body
      .split("")
      .map((ch) => SUPERSCRIPTS[ch] ?? ch)
      .join(""),
  );
  text = text.replace(/\^([0-9a-zA-Z])/g, (_, ch: string) => SUPERSCRIPTS[ch] ?? ch);

  // Нижние индексы: x_{1} → x₁, x_0 → x₀.
  const SUBSCRIPTS: Record<string, string> = {
    "0": "₀",
    "1": "₁",
    "2": "₂",
    "3": "₃",
    "4": "₄",
    "5": "₅",
    "6": "₆",
    "7": "₇",
    "8": "₈",
    "9": "₉",
  };
  text = text.replace(/_\{([^{}]*)\}/g, (_, body: string) =>
    body
      .split("")
      .map((ch) => SUBSCRIPTS[ch] ?? ch)
      .join(""),
  );
  text = text.replace(/_([0-9])/g, (_, ch: string) => SUBSCRIPTS[ch] ?? ch);

  for (const [pattern, replacement] of LATEX_COMMANDS) {
    text = text.replace(pattern, replacement);
  }

  // Убираем оставшиеся одиночные слэши команд (\, \! и т.п.).
  text = text.replace(/\\[a-zA-Z]+/g, "");
  return text.replace(/\s+/g, " ").trim();
}
