/**
 * Контракт ИИ-движка Лицея Сингулярити (этап 8).
 *
 * Чистые типы и runtime-константы, которые разделяют все провайдеры
 * (`groq.ts`, `gemini.ts`, `openrouter.ts`, `mock.ts`) и надстройка
 * авто-выбора `AutoAIProvider` в `src/lib/ai-provider.ts`.
 *
 * Модуль не зависит ни от Next.js, ни от DOM, ни от других провайдеров —
 * его безопасно импортировать и на сервере, и в браузере.
 *
 * ВАЖНО ДЛЯ ДЕПЛОЯ: все сетевые вызовы внешних ИИ выполняются ТОЛЬКО на
 * сервере (Vercel edge/lambda в Европе). Браузер пользователя обращается
 * лишь к своему API `/api/ai`, поэтому Groq и Gemini доступны из РФ БЕЗ VPN,
 * а API-ключи никогда не покидают сервер.
 */

/* -------------------------------------------------------------------------- */
/* Действия ИИ-помощника                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Действия ИИ-помощника учителя.
 *
 * `ask` — свободный вопрос учителя: любой текст, задача, уравнение или тема.
 * Именно это действие отправляет панель ИИ-помощника по кнопке «Отправить»
 * (дополнительно к снимку доски, если включён переключатель «Передать доску»).
 */
export type AIAction = "ask" | "summary" | "solve" | "formulas" | "check" | "draw" | "formula";

export const AI_ACTIONS: readonly AIAction[] = [
  "ask",
  "summary",
  "solve",
  "formulas",
  "check",
  "draw",
  "formula",
];

export const AI_ACTION_LABELS: Record<AIAction, string> = {
  ask: "Спроси ИИ",
  summary: "Сделай конспект",
  solve: "Реши задачу",
  formulas: "Все формулы по теме",
  check: "Проверь решение",
  draw: "Нарисуй чертёж по условию",
  formula: "Распознать формулу",
};

/** Действия, требующие аккуратных математических выкладок. */
export const AI_REASONING_ACTIONS: readonly AIAction[] = ["solve", "check"];

export interface AIRequest {
  action: AIAction;
  /** Текстовый запрос учителя (тема, условие, номер задачи…). */
  prompt: string;
  /**
   * PNG-фрагмент доски в формате data URL — для действия `formula`
   * («распознать формулу»). Запросы с изображением маршрутизируются
   * в мультимодальные провайдеры (Gemini Vision → OpenRouter Vision).
   */
  imageDataUrl?: string;
  /** Контекст урока — помогает подобрать тему ответа. */
  context?: {
    meetingTitle?: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Инструкции автоматического черчения (рисует drawing-engine.ts)              */
/* -------------------------------------------------------------------------- */

/** Фигуры, которые умеет рисовать `drawing-engine.ts`. */
export type DrawingShape =
  | "triangle"
  | "circle"
  | "line"
  | "rect"
  | "vector"
  | "graph"
  | "point"
  | "text";

/** Базовые поля любой фигуры. */
interface DrawingBase {
  shape: DrawingShape;
  /** Цвет обводки/заливки (CSS-цвет). */
  color?: string;
  /** Толщина линии в px. */
  strokeWidth?: number;
  /** Подпись рядом с фигурой (например «ABC»). */
  label?: string;
}

export interface TriangleInstruction extends DrawingBase {
  shape: "triangle";
  /** Три точки в координатах «инструкции»: [x, y]. */
  points: [number, number][];
}

export interface CircleInstruction extends DrawingBase {
  shape: "circle";
  center: [number, number];
  radius: number;
}

export interface LineInstruction extends DrawingBase {
  shape: "line";
  from: [number, number];
  to: [number, number];
}

export interface RectInstruction extends DrawingBase {
  shape: "rect";
  topLeft: [number, number];
  width: number;
  height: number;
}

export interface VectorInstruction extends DrawingBase {
  shape: "vector";
  from: [number, number];
  to: [number, number];
}

export interface GraphInstruction extends DrawingBase {
  shape: "graph";
  /** Какую функцию построить. */
  fn: "parabola" | "sine" | "linear" | "cubic";
  /** Область определения, например [-5, 5]. */
  domain: [number, number];
  /** Начало координат графика в координатах «инструкции». */
  origin: [number, number];
  /** Масштаб: сколько пикселей в одной единице. */
  scale: number;
}

export interface PointInstruction extends DrawingBase {
  shape: "point";
  at: [number, number];
}

export interface TextInstruction extends DrawingBase {
  shape: "text";
  at: [number, number];
  text: string;
  fontSize?: number;
}

export type DrawingInstruction =
  | TriangleInstruction
  | CircleInstruction
  | LineInstruction
  | RectInstruction
  | VectorInstruction
  | GraphInstruction
  | PointInstruction
  | TextInstruction;

/* -------------------------------------------------------------------------- */
/* Ответ провайдера                                                            */
/* -------------------------------------------------------------------------- */

export interface AIResponse {
  /** Ответ в Markdown (конспект, решение, список формул…). */
  text: string;
  /** LaTeX-формула — заполняется для действия `formula`. */
  latex?: string;
  /** JSON-инструкции для автоматического черчения (действие `draw`). */
  drawing?: DrawingInstruction[];
  /** Какой провайдер фактически ответил (`groq`, `gemini`, `openrouter`, `mock`). */
  providerId?: string;
  /** Идентификатор модели внешнего провайдера (для бейджа в UI). */
  model?: string;
}

export interface AIProviderInfo {
  /** Стабильный идентификатор провайдера: `groq`, `gemini`, `openrouter`, `mock`, `auto`. */
  id: string;
  /** Человекочитаемое имя для UI. */
  name: string;
  /** `true` — всё работает локально, без внешних вызовов. */
  isLocal: boolean;
}

/* -------------------------------------------------------------------------- */
/* Черновик проверки домашнего задания                                         */
/* -------------------------------------------------------------------------- */

/** Данные для черновика проверки домашнего задания. */
export interface HomeworkReviewRequest {
  /** Условие задания (Markdown). Передаётся для контекста проверки. */
  description: string;
  /** Текст ответа ученика. */
  answer: string;
  /** Максимальный балл за работу. */
  maxScore: number;
  /** Сколько файлов приложено к ответу. */
  attachmentCount: number;
  /** Сдано ли после дедлайна. */
  isLate: boolean;
}

/**
 * Черновик проверки. ВАЖНО: это только предложение для учителя.
 * Оценка и комментарий становятся видны ученику лишь после утверждения учителем.
 */
export interface HomeworkReviewDraft {
  suggestedGrade: number;
  draftComment: string;
  /** Какой провайдер фактически подготовил черновик. */
  providerId?: string;
  /** Модель внешнего провайдера. */
  model?: string;
}

/* -------------------------------------------------------------------------- */
/* Интерфейс провайдера                                                        */
/* -------------------------------------------------------------------------- */

export interface AIProvider extends AIProviderInfo {
  complete(request: AIRequest): Promise<AIResponse>;
  /** Черновик проверки ДЗ (только для учителя). */
  reviewHomework(request: HomeworkReviewRequest): Promise<HomeworkReviewDraft>;
}

export function isAIAction(value: unknown): value is AIAction {
  return typeof value === "string" && (AI_ACTIONS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Диагностика для GET /api/ai                                                 */
/* -------------------------------------------------------------------------- */

export interface AIProviderStatus {
  id: string;
  name: string;
  model: string;
  /** Есть ли API-ключ / готова ли реализация к работе. */
  available: boolean;
  /** Почему провайдер недоступен (нет ключа, не поддерживает изображения…). */
  reason?: string;
  /** Порядок в цепочке фоллбэка для текстовых запросов (0 — первый). */
  textPriority: number | null;
  /** Порядок в цепочке фоллбэка для запросов с изображением доски. */
  visionPriority: number | null;
}
