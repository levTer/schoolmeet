"use client";

/**
 * ИИ-панель учителя Лицея Сингулярити.
 *
 * ГЛАВНОЕ В ПАНЕЛИ — СВОБОДНЫЙ ВВОД: крупная текстовая область, кнопка
 * «Отправить» и микрофон 🎤 (Web Speech API). Учитель может спросить
 * ЧТО УГОДНО — тему, уравнение, задачу, правило, план урока — и отправить
 * запрос в ИИ (Groq / Gemini / OpenRouter через серверный `/api/ai`).
 *
 * МИНИМАЛИЗМ: в основном потоке чата нет громких чипсов-подсказок — всё
 * живёт под одной аккуратной кнопкой «💡 Идеи запросов» (список готовых
 * запросов и режимов). Клик подставляет готовый запрос, который можно
 * отредактировать перед отправкой. Места хватает диалогу и полю ввода.
 *
 * Переключатель «Передать доску» добавляет к запросу PNG-снимок текущей
 * страницы доски — его разбирает мультимодальный Gemini Vision
 * (запросы с изображением автоматически уходят в vision-цепочку).
 *
 * Панель видна ИСКЛЮЧИТЕЛЬНО ролям TEACHER и ADMIN — ученики её не видят
 * (дополнительно к серверному 403 на `/api/ai`). Ответы приходят в Markdown
 * с LaTeX и помечены бейджем фактической модели.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import {
  Bot,
  Expand,
  Eye,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  Send,
  Shrink,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";

import { Markdown } from "@/components/ui/markdown";
import { toast } from "sonner";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import {
  AI_ACTION_LABELS,
  type AIAction,
  type AIResponse,
  type DrawingInstruction,
} from "@/lib/ai-provider";
import { cn } from "@/lib/utils";
import {
  drawCommand,
  extractDrawCommand,
  getCanvasSnapshot,
  isBoardAnalysisRequest,
  isDrawRequest,
  isWhiteboardOpen,
  subscribeWhiteboardBridge,
} from "@/lib/whiteboard-bridge";
import type { Role } from "@/types";

/* -------------------------------------------------------------------------- */
/* Типы                                                                        */
/* -------------------------------------------------------------------------- */

export interface AIAssistantProps {
  /** Роль текущего пользователя — защита от рендера для учеников. */
  role: Role;
  /** Название урока — попадает в контекст запросов. */
  meetingTitle: string;
  /** ИИ вернул JSON-инструкции — нарисовать их на доске. */
  onApplyDrawing: (instructions: DrawingInstruction[]) => void;
  /** Снимок доски (PNG data URL) для переключателя «Передать доску». */
  captureBoard?: () => string | null;
  onClose: () => void;
  /**
   * Плавающий вид: панель занимает всё окно контейнера (глобальный виджет ИИ).
   * В этом режиме окно перетаскивается за шапку и ресайзится контейнером,
   * а кнопка «развернуть» переключает полноэкранный режим.
   */
  floating?: boolean;
  /** Перетаскивание плавающего окна за шапку (реализация — в `AIWidget`). */
  onHeaderMouseDown?: (event: ReactMouseEvent<HTMLElement>) => void;
  /** Перетаскивание плавающего окна касанием за шапку (реализация — в `AIWidget`). */
  onHeaderTouchStart?: (event: ReactTouchEvent<HTMLElement>) => void;
  /** Идёт ли перетаскивание окна прямо сейчас (курсор шапки — grabbing). */
  dragging?: boolean;
  /** Развёрнуто ли плавающее окно на весь экран (управляется `AIWidget`). */
  maximized?: boolean;
  /** Переключить полноэкранный режим плавающего окна (кнопка Expand / Compress). */
  onToggleMaximized?: () => void;
}

interface ChatEntry {
  id: string;
  author: "user" | "assistant";
  text: string;
  drawing?: DrawingInstruction[];
  applied?: boolean;
  /** К запросу прикладывался снимок доски. */
  withBoard?: boolean;
  /** Какой провайдер/модель фактически ответили (бейдж прозрачности). */
  providerId?: string;
  model?: string;
}

/** Короткие имена провайдеров для бейджа ответа. */
const PROVIDER_BADGES: Record<string, string> = {
  groq: "Groq",
  gemini: "Gemini Vision",
  openrouter: "OpenRouter",
  mock: "локальный режим",
};

/**
 * Режимы ИИ под кнопкой «💡 Идеи запросов»: клик подставляет готовый запрос
 * (и переключает действие ИИ — например, «чертёж» рисует фигуры на доске).
 */
const QUICK_HINTS: Array<{ action: AIAction; icon: LucideIcon }> = [
  { action: "summary", icon: Sparkles },
  { action: "formulas", icon: Sparkles },
  { action: "solve", icon: Sparkles },
  { action: "check", icon: Sparkles },
  { action: "draw", icon: Sparkles },
];

/** Готовые текстовые запросы в пустом состоянии: их можно отредактировать до отправки. */
const QUICK_PROMPTS = [
  { label: "💡 Объясни тему по шагам", prompt: "Объясни тему по шагам" },
  { label: "📝 Составь план подготовки", prompt: "Составь план подготовки" },
  { label: "🔍 Проверь моё решение", prompt: "Проверь моё решение" },
  { label: "⚡ Сделай краткую выжимку ДЗ", prompt: "Сделай краткую выжимку ДЗ" },
] as const;

const ACTION_DEFAULT_PROMPTS: Record<AIAction, string> = {
  ask: "",
  draw: "Треугольник ABC, прямоугольный в B, катеты AB = 3, BC = 4. Построй чертёж.",
  summary: "Сделай конспект по теме урока",
  formulas: "Все формулы по теме урока",
  check: "Проверь решение задачи",
  solve: "Реши задачу по шагам",
  formula: "Распознай формулу",
};

/** Запрос подробного Vision-разбора доски (кнопка «Проанализировать доску»). */
const ANALYZE_BOARD_PROMPT =
  "Проанализируй доску: распознай весь написанный текст и математические формулы (перепиши их в LaTeX), опиши геометрические фигуры, графики и схемы, проверь выкладки на ошибки и дай подробный разбор — что на доске, что верно, где ошибки и какой следующий шаг.";

/** Подсказка-заголовок над шаблонами. */
const QUICK_HINTS_HINT: Partial<Record<AIAction, string>> = {
  summary: "Конспект по теме",
  formulas: "Шпаргалка с формулами",
  solve: "Пошаговое решение",
  check: "Чек-лист проверки",
  draw: "Условие → чертёж на доске",
};

/* -------------------------------------------------------------------------- */
/* Компонент                                                                   */
/* -------------------------------------------------------------------------- */

export function AIAssistant({
  role,
  meetingTitle,
  onApplyDrawing,
  captureBoard,
  onClose,
  floating = false,
  onHeaderMouseDown,
  onHeaderTouchStart,
  dragging = false,
  maximized = false,
  onToggleMaximized,
}: AIAssistantProps) {
  // Ученикам панель не показывается (сервер тоже вернёт 403).
  const visible = role === "TEACHER" || role === "ADMIN";

  const [input, setInput] = useState("");
  /** Действие из быстрой подсказки; `null` — свободный вопрос («ask»). */
  const [pendingAction, setPendingAction] = useState<AIAction | null>(null);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  /**
   * Развёрнуто ли окно на весь экран: плавающее окно управляется снаружи
   * (`AIWidget`, кнопка Expand / Compress), встроенное — локальным стейтом.
   */
  const isExpanded = onToggleMaximized ? maximized : isMaximized;
  const toggleExpanded = useCallback(() => {
    if (onToggleMaximized) onToggleMaximized();
    else setIsMaximized((value) => !value);
  }, [onToggleMaximized]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [boardAttached, setBoardAttached] = useState(false);
  const [providerName, setProviderName] = useState("ИИ-движок SchoolMeet");
  const [providerIsLocal, setProviderIsLocal] = useState(true);
  const [interim, setInterim] = useState("");
  /** Показывать ли свёрнутый блок «Идеи запросов» (вместо громких чипсов). */
  const [ideasOpen, setIdeasOpen] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** Область с кнопкой и списком «Идеи запросов» — для закрытия по клику вне. */
  const ideasRef = useRef<HTMLElement | null>(null);

  /**
   * Доступность доски определяет реестр моста ИИ↔доска: доска регистрируется
   * при открытии и снимается при закрытии, поэтому кнопки снимка/анализа
   * честно отключаются, когда доски на экране нет.
   */
  const bridgeReady = useSyncExternalStore(subscribeWhiteboardBridge, isWhiteboardOpen, () => false);
  const boardSupported = bridgeReady;

  /** Снимок доски: сначала мост (`getCanvasSnapshot`), затем legacy-пропс родителя. */
  const takeBoardSnapshot = useCallback((): string | null => {
    return getCanvasSnapshot() ?? captureBoard?.() ?? null;
  }, [captureBoard]);

  /**
   * Нарисовать фигуры ИИ на доске через мост (`drawCommand`). Если доска
   * закрыта, чертёж НЕ теряется: запись чата сохранит инструкции и покажет
   * кнопку «Нарисовать на доске», когда доску откроют.
   */
  const applyDrawingViaBridge = useCallback(
    (instructions: DrawingInstruction[]): boolean => {
      const result = drawCommand(instructions);
      if (!result.applied) onApplyDrawing(instructions);
      return result.applied;
    },
    [onApplyDrawing],
  );

  /* ----------------------------- Голосовой ввод -------------------------- */

  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    if (isFinal) {
      setInterim("");
      setPendingAction(null);
      setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
    } else {
      setInterim(text);
    }
  }, []);

  const voice = useVoiceInput({ lang: "ru-RU", onTranscript: handleTranscript });

  // Ошибка голосового ввода (onerror / отказ в микрофоне) — toast + подпись
  // в футере. Показываем каждую новую ошибку один раз.
  const lastVoiceErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (voice.error && voice.error !== lastVoiceErrorRef.current) {
      toast.error(voice.error);
    }
    lastVoiceErrorRef.current = voice.error;
  }, [voice.error]);

  /* ----------------------------- Провайдер ------------------------------- */

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const provider = data?.data?.provider;
        if (typeof provider?.name === "string") setProviderName(provider.name);
        if (typeof provider?.isLocal === "boolean") setProviderIsLocal(provider.isLocal);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Прокрутка к последнему ответу.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [entries.length, loading]);

  // Блок «Идеи запросов» закрывается по клику вне него.
  useEffect(() => {
    if (!ideasOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && ideasRef.current?.contains(target)) return;
      setIdeasOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [ideasOpen]);

  /* ----------------------------- Отправка -------------------------------- */

  const send = useCallback(
    async (options?: { promptOverride?: string; forceBoard?: boolean }) => {
    if (loading) return;

    const prompt = (options?.promptOverride ?? input).trim();
    if (!prompt) {
      setError("Введите вопрос, задачу или тему — или выберите подсказку ниже.");
      inputRef.current?.focus();
      return;
    }

    // Свободный текст уходит действием «ask»; подсказка может задать своё
    // действие. Свободная просьба «нарисуй …» маршрутизируется в «draw»,
    // чтобы модель вернула структурированный JSON-чертёж для доски.
    const action: AIAction =
      pendingAction ?? (!options?.forceBoard && isDrawRequest(prompt) ? "draw" : "ask");

    // Снимок доски для Vision: кнопка «Проанализировать доску», переключатель
    // «Передать доску» или сам вопрос про доску («что на доске?», «проверь
    // решение на доске») — снимок берёт мост (`getCanvasSnapshot`).
    const wantsSnapshot =
      Boolean(options?.forceBoard) || boardAttached || (boardSupported && isBoardAnalysisRequest(prompt));
    let imageDataUrl: string | undefined;
    let snapshotFailed = false;
    if (wantsSnapshot) {
      const snapshot = takeBoardSnapshot();
      if (snapshot) imageDataUrl = snapshot;
      else snapshotFailed = true;
    }
    if (options?.forceBoard && !imageDataUrl) {
      setError("Доска не открыта — откройте доску урока, и я проанализирую её содержимое.");
      return;
    }

    setLoading(true);
    setError(null);
    setWarning(snapshotFailed ? "Не удалось снять копию доски — запрос уйдёт без снимка." : null);
    voice.stop();

    setEntries((prev) => [
      ...prev,
      { id: `u_${Date.now()}`, author: "user", text: prompt, withBoard: Boolean(imageDataUrl) },
    ]);

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, prompt, imageDataUrl, context: { meetingTitle } }),
      });

      if (response.status === 403) {
        setError("Доступ запрещён: ИИ-панель доступна только учителям и администраторам.");
        return;
      }
      if (!response.ok) {
        setError("ИИ-помощник временно недоступен. Попробуйте ещё раз.");
        return;
      }

      const payload = (await response.json()) as { ok: boolean; data?: AIResponse; error?: string };
      if (!payload.ok || !payload.data) {
        setError(payload.error ?? "Не удалось получить ответ ИИ.");
        return;
      }

      const data = payload.data;

      // ИИ рисует на доске: инструкции могут прийти структурированно
      // (`data.drawing`) или JSON-командой {"action":"draw",…} прямо в тексте
      // свободного ответа — перехватываем оба пути и выполняем через мост.
      let answerText = data.text;
      let drawing = data.drawing;
      if ((!drawing || drawing.length === 0) && answerText) {
        const extracted = extractDrawCommand(answerText);
        if (extracted) {
          drawing = extracted.instructions;
          answerText = extracted.text || "## Чертёж по условию";
        }
      }
      let applied = false;
      if (drawing && drawing.length > 0) {
        applied = applyDrawingViaBridge(drawing);
      }

      setEntries((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          author: "assistant",
          text: answerText,
          drawing,
          applied,
          providerId: data.providerId,
          model: data.model,
        },
      ]);
      // Анализ доски не стирает набранный учителем текст.
      if (!options?.promptOverride) {
        setInput("");
        setPendingAction(null);
      }
    } catch {
      setError("Нет соединения с сервером. Проверьте интернет.");
    } finally {
      setLoading(false);
    }
    },
    [
      applyDrawingViaBridge,
      boardAttached,
      boardSupported,
      input,
      loading,
      meetingTitle,
      pendingAction,
      takeBoardSnapshot,
      voice,
    ],
  );

  /** Кнопка «Проанализировать доску»: снимок → Gemini Vision → подробный разбор. */
  const analyzeBoard = useCallback(() => {
    void send({ promptOverride: ANALYZE_BOARD_PROMPT, forceBoard: true });
  }, [send]);

  /** Повторить рисование чертежа из записи чата (доску открыли после ответа ИИ). */
  const applyEntryDrawing = useCallback(
    (entryId: string) => {
      setEntries((prev) =>
        prev.map((entry) => {
          if (entry.id !== entryId || !entry.drawing || entry.applied) return entry;
          return { ...entry, applied: applyDrawingViaBridge(entry.drawing) };
        }),
      );
    },
    [applyDrawingViaBridge],
  );

  /* --------------------------- Идеи запросов ----------------------------- */

  const pickHint = useCallback((hint: AIAction) => {
    setPendingAction(hint);
    setInput(ACTION_DEFAULT_PROMPTS[hint]);
    setError(null);
    setIdeasOpen(false);
    inputRef.current?.focus();
  }, []);

  const pickQuickPrompt = useCallback((prompt: string) => {
    setPendingAction(null);
    setInterim("");
    setInput(prompt);
    setError(null);
    setIdeasOpen(false);
    inputRef.current?.focus();
  }, []);

  const onInputChange = useCallback((value: string) => {
    setInterim("");
    setInput(value);
    setError(null);
    // Ручная правка текста = свободный вопрос: сбрасываем действие-подсказку.
    setPendingAction(null);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const isSendShortcut = !event.shiftKey || event.ctrlKey || event.metaKey;
      if (event.key === "Enter" && isSendShortcut && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void send();
      }
    },
    [send],
  );

  if (!visible) return null;

  /* ----------------------------- Разметка -------------------------------- */

  return (
    <aside
      className={cn(
        "glass flex min-h-0 flex-col overflow-hidden rounded-3xl",
        floating
          ? "h-full w-full"
          : isExpanded
            ? "fixed inset-4 z-50 max-h-none max-w-none shadow-2xl md:inset-10"
            : "h-full w-full md:w-[420px] md:shrink-0 lg:w-[460px]",
      )}
    >
      {/* Шапка — ручка перетаскивания плавающего окна (cursor-grab / cursor-grabbing) */}
      <header
        className={cn(
          "flex select-none items-center gap-2 border-b border-white/10 px-4 py-3",
          onHeaderMouseDown || onHeaderTouchStart
            ? cn("touch-none", dragging ? "cursor-grabbing" : "cursor-grab")
            : "",
        )}
        onMouseDown={onHeaderMouseDown}
        onTouchStart={onHeaderTouchStart}
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
          <Sparkles className="h-4 w-4 text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">ИИ-помощник учителя</p>
          <p className="truncate text-[11px] text-slate-400">
            {providerName} · {providerIsLocal ? "локальный режим" : "серверный прокси · работает без VPN"}
          </p>
        </div>
        {/* Развернуть на весь экран / Восстановить — рядом с крестиком закрытия */}
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label={isExpanded ? "Свернуть ИИ-панель" : "Развернуть ИИ-панель"}
          aria-expanded={isExpanded}
          title={isExpanded ? "Восстановить размер" : "Развернуть на весь экран"}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition hover:bg-white/10"
        >
          {isExpanded ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть ИИ-панель"
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Ответы: занимают всё свободное пространство окна при любом размере */}
      <div ref={listRef} className="min-h-0 flex-1 flex-grow space-y-3 overflow-y-auto px-4 py-3">
        {entries.length === 0 && !loading && (
          <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500/10 via-white/[0.03] to-indigo-500/10 px-5 py-8 text-center">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-400/30 bg-brand-500/15 text-brand-200 shadow-glow">
              <Bot className="h-7 w-7" aria-hidden="true" />
            </span>
            <h2 className="text-base font-semibold text-white">Привет! Я ИИ-помощник</h2>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-400">
              Помогу разобраться в теме, подготовиться к уроку или проверить решение. Напишите вопрос
              ниже, надиктуйте его или откройте «💡 Идеи запросов».
            </p>
            <p className="mt-4 text-[10px] leading-relaxed text-slate-500">
              Можно приложить снимок доски кнопкой «Передать доску» — я учту его в ответе.
            </p>
          </div>
        )}

        {entries.map((entry) =>
          entry.author === "user" ? (
            <div
              key={entry.id}
              className="ml-6 rounded-2xl rounded-br-md bg-brand-500/15 px-3 py-2 text-xs text-slate-100"
            >
              {entry.withBoard ? (
                <span className="mb-1 flex items-center gap-1 text-[10px] text-brand-200">
                  <MonitorUp className="h-3 w-3" /> со снимком доски
                </span>
              ) : null}
              <span className="whitespace-pre-wrap">{entry.text}</span>
            </div>
          ) : (
            <div key={entry.id} className="rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-3 py-2">
              <Markdown text={entry.text} />
              {entry.applied && entry.drawing ? (
                <p className="mt-2 text-[11px] text-accent-300">✓ Чертёж автоматически добавлен на доску</p>
              ) : entry.drawing ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => applyEntryDrawing(entry.id)}
                    disabled={!boardSupported}
                    title={
                      boardSupported ? "Нарисовать фигуры ИИ на открытой доске" : "Откройте доску урока, чтобы нарисовать чертёж"
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent-400/40 bg-accent-500/15 px-2.5 py-1 text-[11px] font-medium text-accent-100 transition hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Sparkles className="h-3 w-3" />
                    Нарисовать на доске
                  </button>
                  {!boardSupported ? (
                    <span className="text-[10px] text-slate-500">Доска закрыта — чертёж сохранён в этой записи</span>
                  ) : null}
                </div>
              ) : null}
              {entry.providerId ? (
                <p className="mt-2 text-[10px] text-slate-500">
                  {PROVIDER_BADGES[entry.providerId] ?? entry.providerId}
                  {entry.model ? ` · ${entry.model}` : ""}
                </p>
              ) : null}
            </div>
          ),
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-brand-300" />
            Помощник готовит ответ…
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        {warning && (
          <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {warning}
          </div>
        )}
      </div>

      {/* Свободный ввод — главный элемент панели */}
      <footer ref={ideasRef} className="relative border-t border-white/10 p-3">
        {voice.error && <p className="mb-2 text-[11px] text-amber-300">{voice.error}</p>}
        {!voice.supported && (
          <p className="mb-2 text-[11px] text-slate-500">
            Голосовой ввод недоступен в этом браузере — используйте Chrome, Edge или Safari.
          </p>
        )}

        {pendingAction && (
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-400/40 bg-brand-500/15 px-2.5 py-1 text-[11px] text-brand-100">
              {AI_ACTION_LABELS[pendingAction]}
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                aria-label="Сбросить режим подсказки"
                className="rounded-full p-0.5 transition hover:bg-white/10"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        <textarea
          ref={inputRef}
          value={interim ? `${input}${input ? " " : ""}${interim}` : input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder="Спросите ИИ что угодно: «реши 2x² − 5x + 3 = 0», «объясни теорему Пифагора», «составь план урока на 45 минут»…"
          aria-label="Вопрос ИИ-помощнику"
          className={cn(
            "resize-y min-h-[52px] max-h-[220px] rounded-xl bg-slate-800/80 border border-slate-700/80 p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-full scrollbar-thin text-slate-100 placeholder:text-slate-500 focus:border-indigo-500",
            interim && "text-slate-400",
          )}
        />

        {/* Кнопки: идеи, голос, «Передать доску», отправить */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIdeasOpen((open) => !open)}
            aria-expanded={ideasOpen}
            aria-label="Идеи запросов"
            title="💡 Идеи запросов"
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-xl border transition",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70",
              ideasOpen
                ? "border-brand-400/50 bg-brand-500/20 text-brand-100"
                : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/10",
            )}
          >
            <Lightbulb className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={voice.toggle}
            disabled={!voice.supported}
            aria-pressed={voice.listening}
            aria-label={voice.listening ? "Остановить голосовой ввод" : "Голосовой ввод"}
            className={cn(
              "inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition",
              voice.listening
                ? "border-rose-400/40 bg-rose-500/20 text-rose-200"
                : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/10",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {voice.listening ? "Стоп" : "🎤 Голос"}
          </button>

          <button
            type="button"
            onClick={analyzeBoard}
            disabled={!boardSupported || loading}
            title={
              boardSupported
                ? "Снять снимок доски и получить подробный разбор (Gemini Vision): текст, формулы, геометрия, ошибки"
                : "Откройте доску урока, чтобы проанализировать её содержимое"
            }
            className={cn(
              "inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition",
              "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/10",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            <Eye className="h-4 w-4" />
            Проанализировать доску
          </button>

          <button
            type="button"
            onClick={() => setBoardAttached((attached) => !attached)}
            disabled={!boardSupported}
            aria-pressed={boardAttached}
            title={
              boardSupported
                ? "Приложить снимок доски к запросу (разбирает Gemini Vision)"
                : "Откройте доску урока, чтобы передать её снимок ИИ"
            }
            className={cn(
              "inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition",
              boardAttached
                ? "border-accent-400/50 bg-accent-500/15 text-accent-100"
                : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/10",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            <MonitorUp className="h-4 w-4" />
            Передать доску
          </button>

          <button
            type="button"
            onClick={() => void send()}
            disabled={loading}
            className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Отправить
          </button>
        </div>

        {voice.listening && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
            Слушаю… Говорите, текст появится в поле ввода.
          </p>
        )}

        {/*
          Минимализм: громкие чипсы-подсказки спрятаны под одной кнопкой
          «💡 Идеи запросов» — основной поток чата и поле ввода остаются
          главным содержимым окна.
        */}
        {ideasOpen && (
          <div className="absolute bottom-full right-3 z-20 mb-2 w-[min(17rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-ink-900/95 p-2 shadow-2xl backdrop-blur-xl">
            <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              💡 Идеи запросов
            </p>

            <div className="flex flex-col gap-0.5">
              {QUICK_PROMPTS.map((quickPrompt) => (
                <button
                  key={quickPrompt.label}
                  type="button"
                  onClick={() => pickQuickPrompt(quickPrompt.prompt)}
                  className="rounded-lg px-2 py-1.5 text-left text-[11px] text-slate-200 transition hover:bg-white/[0.08] hover:text-white"
                >
                  {quickPrompt.label}
                </button>
              ))}
            </div>

            <div className="mt-1.5 border-t border-white/5 pt-1.5">
              <p className="px-1 pb-1 text-[10px] uppercase tracking-wider text-slate-600">Режимы</p>
              <div className="flex flex-wrap gap-1">
                {QUICK_HINTS.map((hint) => (
                  <button
                    key={hint.action}
                    type="button"
                    onClick={() => pickHint(hint.action)}
                    title={QUICK_HINTS_HINT[hint.action] ?? AI_ACTION_LABELS[hint.action]}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition",
                      pendingAction === hint.action
                        ? "border-brand-400/50 bg-brand-500/15 text-white"
                        : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.09]",
                    )}
                  >
                    <hint.icon className="h-3 w-3" />
                    {AI_ACTION_LABELS[hint.action]}
                  </button>
                ))}
              </div>
            </div>

            <p className="px-1 pt-1.5 text-[10px] leading-relaxed text-slate-500">
              Подсказка подставит готовый запрос — его можно отредактировать. Enter — отправить,
              Shift+Enter — новая строка.
            </p>
          </div>
        )}
      </footer>
    </aside>
  );
}
