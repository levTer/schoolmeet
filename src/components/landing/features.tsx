import {
  CalendarDays,
  Check,
  MessageSquareLock,
  PenTool,
  Sparkles,
  Video,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface Feature {
  icon: typeof Video;
  title: string;
  description: string;
  bullets: readonly string[];
  badge?: string;
  span?: string;
  tone?: "violet" | "sky" | "emerald" | "amber";
  visual?: "board" | "schedule";
}

const FEATURES: readonly Feature[] = [
  {
    icon: Video,
    title: "HD Видеозвонки",
    description:
      "Кристально чистые уроки на WebRTC и PeerJS: до 50 участников, мгновенное переподключение и адаптивный битрейт даже на слабом интернете.",
    bullets: ["Демонстрация экрана", "Поднятие руки", "Включение/выключение микрофона"],
    tone: "violet",
  },
  {
    icon: PenTool,
    title: "Интерактивная доска",
    description:
      "Fabric.js для рисования поверх урока и GPT-4o Vision, который считывает handwriting: разбирает формулы, условия задач и сразу предлагает решение.",
    bullets: ["Распознавание формул и графиков", "Авто-решение и пояснения", "Совместное рисование"],
    badge: "GPT-4o Vision",
    span: "lg:col-span-2",
    tone: "sky",
    visual: "board",
  },
  {
    icon: CalendarDays,
    title: "Школьное расписание",
    description:
      "Недельная сетка уроков с ограничением ролей: учитель планирует слоты и привязывает комнаты, ученик видит только своё расписание и входит в урок в один клик.",
    bullets: ["Учитель планирует", "Ученик смотрит", "Авто-создание комнаты к началу урока"],
    span: "lg:col-span-2",
    tone: "emerald",
    visual: "schedule",
  },
  {
    icon: MessageSquareLock,
    title: "Защищённый сквозной чат",
    description:
      "Сообщения шифруются AES-256 на клиенте: сервер хранит только шифротекст и не может прочитать переписку класса.",
    bullets: ["AES-256 end-to-end", "Ключ на урок", "Модерация и история"],
    tone: "amber",
  },
] as const;

const TONES = {
  violet: "from-violet-500/25 to-violet-500/0 text-violet-200 ring-violet-400/20",
  sky: "from-sky-500/25 to-sky-500/0 text-sky-200 ring-sky-400/20",
  emerald: "from-emerald-500/25 to-emerald-500/0 text-emerald-200 ring-emerald-400/20",
  amber: "from-amber-500/25 to-amber-500/0 text-amber-200 ring-amber-400/20",
} as const;

export function Features() {
  return (
    <section id="features" className="relative scroll-mt-28 py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {/* Заголовок секции */}
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-xs font-medium uppercase tracking-widest text-slate-400">
            <Sparkles className="h-3.5 w-3.5 text-brand-300" />
            Возможности
          </span>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-5xl">
            Всё, что нужно современному <span className="text-gradient-brand">уроку</span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-400 sm:text-lg">
            Четыре модуля, которые заменяют учителю зоопарк из пяти сервисов: связь, доска,
            расписание и безопасный чат.
          </p>
        </div>

        {/* Bento-сетка */}
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article
              key={feature.title}
              className={cn(
                "group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025] p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.05] sm:p-7",
                feature.span,
              )}
            >
              {/* Градиент при наведении */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                style={{
                  background:
                    "radial-gradient(28rem 20rem at 100% 0%, rgba(139,92,246,.16), transparent 60%)",
                }}
              />

              <div className="relative flex items-start justify-between gap-4">
                <span
                  className={cn(
                    "inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ring-1",
                    TONES[feature.tone ?? "violet"],
                  )}
                >
                  <feature.icon className="h-5 w-5" strokeWidth={2} />
                </span>

                {feature.badge && (
                  <span className="rounded-full border border-brand-400/30 bg-brand-500/10 px-3 py-1 text-[11px] font-medium text-brand-200">
                    {feature.badge}
                  </span>
                )}
              </div>

              <h3 className="relative mt-5 text-xl font-semibold text-white">{feature.title}</h3>
              <p className="relative mt-2.5 text-sm leading-relaxed text-slate-400">
                {feature.description}
              </p>

              <ul className="relative mt-5 space-y-2">
                {feature.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-center gap-2.5 text-sm text-slate-300">
                    <span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-500/15 text-brand-200">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    {bullet}
                  </li>
                ))}
              </ul>

              {feature.visual === "board" && <BoardVisual />}
              {feature.visual === "schedule" && <ScheduleVisual />}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Мини-превью ИИ-доски: график, который «понял» ассистент. */
function BoardVisual() {
  return (
    <div className="relative mt-6 overflow-hidden rounded-2xl border border-white/10 bg-ink-950/70 p-4">
      <div aria-hidden className="absolute inset-0 bg-grid opacity-30" />
      <div className="relative flex items-center justify-between text-[11px] text-slate-500">
        <span>Доска · урок 24</span>
        <span className="text-brand-300">распознано ИИ</span>
      </div>

      <svg
        viewBox="0 0 320 120"
        className="relative mt-2 h-28 w-full text-brand-300"
        role="img"
        aria-label="График квадратичной функции на доске"
      >
        <line x1="20" y1="60" x2="300" y2="60" stroke="currentColor" strokeOpacity="0.25" />
        <line x1="160" y1="10" x2="160" y2="110" stroke="currentColor" strokeOpacity="0.25" />
        <path
          d="M40 108 Q160 -30 280 108"
          fill="none"
          stroke="url(#boardStroke)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="160" cy="38" r="4" fill="#38bdf8" />
        <defs>
          <linearGradient id="boardStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
      </svg>

      <p className="relative mt-1 font-mono text-[11px] text-slate-400">
        y = x² − 4x + 3 · вершина (2; −1)
      </p>
    </div>
  );
}

/** Мини-превью расписания: сетка недели. */
function ScheduleVisual() {
  const days = [
    { day: "Пн", lessons: ["Алгебра", "Геометрия"] },
    { day: "Вт", lessons: ["Физика"] },
    { day: "Ср", lessons: ["Алгебра", "Информ."] },
    { day: "Чт", lessons: ["Геометрия"] },
    { day: "Пт", lessons: ["Алгебра"] },
  ] as const;

  return (
    <div className="relative mt-6 grid grid-cols-5 gap-2">
      {days.map((item) => (
        <div
          key={item.day}
          className="rounded-xl border border-white/10 bg-ink-950/70 p-2 text-center"
        >
          <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.day}</p>
          <div className="mt-1.5 space-y-1">
            {item.lessons.map((lesson) => (
              <p
                key={lesson}
                className="truncate rounded-md bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 px-1 py-1 text-[10px] font-medium text-emerald-100"
              >
                {lesson}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
