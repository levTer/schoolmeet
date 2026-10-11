"use client";

/**
 * ИИ-панель учителя SchoolMeet (этап 8 — внешний ИИ-движок).
 *
 * Отображается ИСКЛЮЧИТЕЛЬНО для ролей TEACHER и ADMIN — ученики этот
 * компонент не видят (дополнительно к серверному 403 на `/api/ai`).
 *
 * Ответы готовит серверный ИИ-движок с авто-фоллбэком (Groq → OpenRouter →
 * Gemini → локальный Mock; распознавание формул с доски — Gemini Vision).
 * Все внешние вызовы выполняет сервер (`/api/ai`), поэтому ИИ работает
 * в РФ БЕЗ VPN, а каждый ответ помечен бейджем фактической модели.
 * Голосовой ввод работает через нативный Web Speech API браузера
 * (`useVoiceInput`) и всегда попадает в поле ввода для проверки и
 * редактирования перед отправкой.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Send, Sparkles, X, type LucideIcon } from "lucide-react";

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
  onClose: () => void;
}

interface ChatEntry {
  id: string;
  author: "user" | "assistant";
  text: string;
  drawing?: DrawingInstruction[];
  applied?: boolean;
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

/** Шаблоны-кнопки панели (порядок согласован с заданием). */
const TEMPLATES: Array<{ action: AIAction; icon: LucideIcon; hint: string }> = [
  { action: "draw", icon: Sparkles, hint: "Условие → чертёж на доске" },
  { action: "summary", icon: Sparkles, hint: "Конспект по теме урока" },
  { action: "formulas", icon: Sparkles, hint: "Шпаргалка с формулами" },
  { action: "check", icon: Sparkles, hint: "Чек-лист проверки решения" },
];

const ACTION_DEFAULT_PROMPTS: Record<AIAction, string> = {
  draw: "Треугольник ABC, прямоугольный в B, катеты AB = 3, BC = 4. Построй чертёж.",
  summary: "Сделай конспект по теме урока",
  formulas: "Все формулы по теме урока",
  check: "Проверь решение задачи",
  solve: "Реши задачу по шагам",
  formula: "Распознай формулу",
};

/* -------------------------------------------------------------------------- */
/* Компонент                                                                   */
/* -------------------------------------------------------------------------- */

export function AIAssistant({ role, meetingTitle, onApplyDrawing, onClose }: AIAssistantProps) {
  // Ученикам панель не показывается (сервер тоже вернёт 403).
  const visible = role === "TEACHER" || role === "ADMIN";

  const [input, setInput] = useState("");
  const [action, setAction] = useState<AIAction>("summary");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerName, setProviderName] = useState("ИИ-движок SchoolMeet");
  const [providerIsLocal, setProviderIsLocal] = useState(true);
  const [interim, setInterim] = useState("");

  const listRef = useRef<HTMLDivElement | null>(null);

  /* ----------------------------- Голосовой ввод -------------------------- */

  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    if (isFinal) {
      setInterim("");
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

  const send = useCallback(
    async (nextAction: AIAction = action) => {
      const prompt = input.trim();
      if (loading) return;
      setLoading(true);
      setError(null);
      voice.stop();

      setEntries((prev) => [
        ...prev,
        {
          id: `u_${Date.now()}`,
          author: "user",
          text: prompt || ACTION_DEFAULT_PROMPTS[nextAction],
        },
      ]);

      try {
        const response = await fetch("/api/ai", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: nextAction,
            prompt: prompt || ACTION_DEFAULT_PROMPTS[nextAction],
            context: { meetingTitle },
          }),
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
        if (nextAction === "draw" && data.drawing && data.drawing.length > 0) {
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
      } catch {
        setError("Нет соединения с сервером. Проверьте интернет.");
      } finally {
        setLoading(false);
      }
    },
    [action, input, loading, meetingTitle, onApplyDrawing, voice],
  );

  const pickTemplate = useCallback((next: AIAction) => {
    setAction(next);
    setInput((prev) => prev || ACTION_DEFAULT_PROMPTS[next]);
  }, []);

  if (!visible) return null;

  /* ----------------------------- Разметка -------------------------------- */

  return (
    <aside className="glass flex h-full w-full flex-col overflow-hidden rounded-3xl md:w-[360px] md:shrink-0">
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
          onClick={onClose}
          aria-label="Закрыть ИИ-панель"
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Шаблоны */}
      <div className="grid grid-cols-2 gap-2 border-b border-white/10 p-3">
        {TEMPLATES.map((template) => {
          const label = AI_ACTION_LABELS[template.action];
          return (
            <button
              key={template.action}
              type="button"
              onClick={() => pickTemplate(template.action)}
              className={cn(
                "rounded-2xl border px-3 py-2.5 text-left transition",
                action === template.action
                  ? "border-brand-400/50 bg-brand-500/15 text-white"
                  : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]",
              )}
            >
              <span className="block text-xs font-semibold leading-tight">{label}</span>
              <span className="mt-0.5 block text-[10px] leading-tight text-slate-400">{template.hint}</span>
            </button>
          );
        })}
      </div>

      {/* Ответы */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {entries.length === 0 && !loading && (
          <div className="rounded-2xl border border-dashed border-white/15 p-4 text-xs leading-relaxed text-slate-400">
            Выберите шаблон, при необходимости отредактируйте запрос и нажмите «Отправить».
            Можно надиктовать текст кнопкой 🎤 — он появится в поле ввода.
          </div>
        )}

        {entries.map((entry) =>
          entry.author === "user" ? (
            <div key={entry.id} className="ml-6 rounded-2xl rounded-br-md bg-brand-500/15 px-3 py-2 text-xs text-slate-100">
              {entry.text}
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
      </div>

      {/* Ввод */}
      <footer className="border-t border-white/10 p-3">
        {voice.error && <p className="mb-2 text-[11px] text-amber-300">{voice.error}</p>}
        {!voice.supported && (
          <p className="mb-2 text-[11px] text-slate-500">
            Голосовой ввод недоступен в этом браузере — используйте Chrome, Edge или Safari.
          </p>
        )}

        <div className="relative">
          <textarea
            value={interim ? `${input}${input ? " " : ""}${interim}` : input}
            onChange={(event) => {
              setInterim("");
              setInput(event.target.value);
            }}
            rows={3}
            placeholder="Напишите запрос или надиктуйте его…"
            className={cn(
              "w-full resize-none rounded-2xl border border-white/10 bg-ink-900/70 px-3 py-2.5 pr-24 text-xs text-slate-100",
              "placeholder:text-slate-500 focus:border-brand-400/50 focus:outline-none focus:ring-2 focus:ring-brand-500/30",
              interim && "text-slate-400",
            )}
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={voice.toggle}
              disabled={!voice.supported}
              aria-label={voice.listening ? "Остановить голосовой ввод" : "Голосовой ввод"}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-xl border transition",
                voice.listening
                  ? "border-rose-400/40 bg-rose-500/20 text-rose-200"
                  : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/10",
                "disabled:cursor-not-allowed disabled:opacity-40",
              )}
            >
              {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading}
              aria-label="Отправить запрос"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-gradient px-3 text-xs font-semibold text-white shadow-glow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {voice.listening && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
            Слушаю… Говорите, текст появится в поле ввода.
          </p>
        )}
      </footer>
    </aside>
  );
}
