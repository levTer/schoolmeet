"use client";

/**
 * ИИ-панель учителя Лицея Сингулярити.
 *
 * ГЛАВНОЕ В ПАНЕЛИ — СВОБОДНЫЙ ВВОД: крупная текстовая область, кнопка
 * «Отправить» и микрофон 🎤 (Web Speech API). Учитель может спросить
 * ЧТО УГОДНО — тему, уравнение, задачу, правило, план урока — и отправить
 * запрос в ИИ (Groq / Gemini / OpenRouter через серверный `/api/ai`).
 * Шаблоны («Сделай конспект», «Все формулы»…) живут НИЖЕ поля ввода как
 * быстрые подсказки: клик подставляет готовый запрос, который можно
 * отредактировать перед отправкой.
 *
 * Переключатель «Передать доску» добавляет к запросу PNG-снимок текущей
 * страницы доски — его разбирает мультимодальный Gemini Vision
 * (запросы с изображением автоматически уходят в vision-цепочку).
 *
 * Панель видна ИСКЛЮЧИТЕЛЬНО ролям TEACHER и ADMIN — ученики её не видят
 * (дополнительно к серверному 403 на `/api/ai`). Ответы приходят в Markdown
 * с LaTeX и помечены бейджем фактической модели.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Bot,
  Expand,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  Send,
  Shrink,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { Markdown } from "@/components/ui/markdown";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import {
  AI_ACTION_LABELS,
  type AIAction,
  type AIResponse,
  type DrawingInstruction,
} from "@/lib/ai-provider";
import { cn } from "@/lib/utils";
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
 * Быстрые подсказки под полем ввода: клик подставляет готовый запрос
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
}: AIAssistantProps) {
  // Ученикам панель не показывается (сервер тоже вернёт 403).
  const visible = role === "TEACHER" || role === "ADMIN";

  const [input, setInput] = useState("");
  /** Действие из быстрой подсказки; `null` — свободный вопрос («ask»). */
  const [pendingAction, setPendingAction] = useState<AIAction | null>(null);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [boardAttached, setBoardAttached] = useState(false);
  const [providerName, setProviderName] = useState("ИИ-движок SchoolMeet");
  const [providerIsLocal, setProviderIsLocal] = useState(true);
  const [interim, setInterim] = useState("");

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const boardSupported = Boolean(captureBoard);

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

  /* ----------------------------- Отправка -------------------------------- */

  const send = useCallback(async () => {
    if (loading) return;

    const prompt = input.trim();
    if (!prompt) {
      setError("Введите вопрос, задачу или тему — или выберите подсказку ниже.");
      inputRef.current?.focus();
      return;
    }

    // Свободный текст уходит действием «ask»; подсказка может задать своё действие.
    const action: AIAction = pendingAction ?? "ask";

    // Снимок доски (если включён переключатель «Передать доску»).
    let imageDataUrl: string | undefined;
    let snapshotFailed = false;
    if (boardAttached && captureBoard) {
      const snapshot = captureBoard();
      if (snapshot) imageDataUrl = snapshot;
      else snapshotFailed = true;
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
      let applied = false;
      if (data.drawing && data.drawing.length > 0) {
        onApplyDrawing(data.drawing);
        applied = true;
      }

      setEntries((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          author: "assistant",
          text: data.text,
          drawing: data.drawing,
          applied,
          providerId: data.providerId,
          model: data.model,
        },
      ]);
      setInput("");
      setPendingAction(null);
    } catch {
      setError("Нет соединения с сервером. Проверьте интернет.");
    } finally {
      setLoading(false);
    }
  }, [boardAttached, captureBoard, input, loading, meetingTitle, onApplyDrawing, pendingAction, voice]);

  /* --------------------------- Быстрые подсказки -------------------------- */

  const pickHint = useCallback((hint: AIAction) => {
    setPendingAction(hint);
    setInput(ACTION_DEFAULT_PROMPTS[hint]);
    setError(null);
    inputRef.current?.focus();
  }, []);

  const pickQuickPrompt = useCallback((prompt: string) => {
    setPendingAction(null);
    setInterim("");
    setInput(prompt);
    setError(null);
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
        isMaximized
          ? "fixed inset-4 md:inset-10 z-50 max-w-none max-h-none shadow-2xl"
          : "h-full w-full md:w-[420px] md:shrink-0 lg:w-[460px]",
      )}
    >
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
          <Sparkles className="h-4 w-4 text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">ИИ-помощник учителя</p>
          <p className="truncate text-[11px] text-slate-400">
            {providerName} · {providerIsLocal ? "локальный режим" : "серверный прокси · работает без VPN"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsMaximized((maximized) => !maximized)}
          aria-label={isMaximized ? "Свернуть ИИ-панель" : "Развернуть ИИ-панель"}
          aria-expanded={isMaximized}
          title={isMaximized ? "Свернуть окно" : "Развернуть на весь экран"}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition hover:bg-white/10"
        >
          {isMaximized ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
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

      {/* Ответы */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {entries.length === 0 && !loading && (
          <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500/10 via-white/[0.03] to-indigo-500/10 px-5 py-8 text-center">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-400/30 bg-brand-500/15 text-brand-200 shadow-glow">
              <Bot className="h-7 w-7" aria-hidden="true" />
            </span>
            <h2 className="text-base font-semibold text-white">Привет! Я ИИ-помощник</h2>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-400">
              Помогу разобраться в теме, подготовиться к уроку или проверить решение. Напишите вопрос
              ниже, надиктуйте его или выберите одну из подсказок.
            </p>
            <div className="mt-5 flex w-full flex-wrap justify-center gap-2">
              {QUICK_PROMPTS.map((quickPrompt) => (
                <button
                  key={quickPrompt.label}
                  type="button"
                  onClick={() => pickQuickPrompt(quickPrompt.prompt)}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-[11px] font-medium text-slate-200 transition hover:border-brand-400/40 hover:bg-brand-500/10 hover:text-white"
                >
                  {quickPrompt.label}
                </button>
              ))}
            </div>
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
      <footer className="border-t border-white/10 p-3">
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
          rows={4}
          placeholder="Спросите ИИ что угодно: «реши 2x² − 5x + 3 = 0», «объясни теорему Пифагора», «составь план урока на 45 минут»…"
          aria-label="Вопрос ИИ-помощнику"
          className={cn(
            "resize-y min-h-[52px] max-h-[220px] rounded-xl bg-slate-800/80 border border-slate-700/80 p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-full scrollbar-thin text-slate-100 placeholder:text-slate-500 focus:border-indigo-500",
            interim && "text-slate-400",
          )}
        />

        {/* Кнопки: голос, «Передать доску», отправить */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
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
            onClick={() => setBoardAttached((attached) => !attached)}
            disabled={!boardSupported}
            aria-pressed={boardAttached}
            title={
              boardSupported
                ? "Приложить снимок доски к запросу (разбирает Gemini Vision)"
                : "Доска недоступна"
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

        {/* Быстрые подсказки — ниже поля ввода */}
        <div className="mt-3 border-t border-white/5 pt-2.5">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <Zap className="h-3 w-3" />
            Быстрые подсказки
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_HINTS.map((hint) => (
              <button
                key={hint.action}
                type="button"
                onClick={() => pickHint(hint.action)}
                title={QUICK_HINTS_HINT[hint.action] ?? AI_ACTION_LABELS[hint.action]}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition",
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
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            Подсказка подставит готовый запрос — его можно отредактировать перед отправкой. Enter —
            отправить, Shift+Enter — новая строка.
          </p>
        </div>
      </footer>
    </aside>
  );
}
