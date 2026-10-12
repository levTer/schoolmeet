import {
  Hand,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Sparkles,
  Video,
  VideoOff,
} from "lucide-react";

import { cn } from "@/lib/utils";

const STUDENTS = [
  { initials: "ПК", name: "Полина К.", muted: false, hand: true, tone: "from-sky-500/40 to-indigo-900/70" },
  { initials: "ДМ", name: "Дмитрий М.", muted: true, hand: false, tone: "from-emerald-500/35 to-slate-900/80" },
  { initials: "АЛ", name: "Алина Л.", muted: false, hand: false, tone: "from-fuchsia-500/35 to-slate-900/80" },
] as const;

/** Интерактивный мокап окна урока — показываем продукт, а не описываем его. */
export function ProductPreview() {
  return (
    <div className="relative mx-auto mt-16 max-w-5xl animate-fade-up [animation-delay:220ms] sm:mt-20">
      {/* Свечение под окном */}
      <div
        aria-hidden
        className="absolute -inset-x-10 -top-10 bottom-0 -z-10 rounded-[3rem] bg-brand-gradient opacity-20 blur-3xl"
      />

      <div className="ring-gradient overflow-hidden rounded-3xl border border-white/10 bg-ink-900/80 shadow-2xl backdrop-blur-xl">
        {/* Верхняя панель «окна» */}
        <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="hidden sm:inline">Алгебра · 8 «Б»</span>
            <span className="rounded-md bg-white/5 px-2 py-1 font-mono text-[11px] text-slate-300">
              KLM-4821
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-red-500/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Live
            </span>
          </div>
        </div>

        {/* Видеосетка */}
        <div className="grid gap-3 p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Плитка учителя */}
            <div className="relative aspect-video overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600/50 via-indigo-900/70 to-ink-900 sm:col-span-2">
              <div
                aria-hidden
                className="absolute inset-0 bg-grid opacity-25"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-xl font-semibold text-white ring-1 ring-white/20 backdrop-blur">
                  АС
                  <span className="absolute -inset-1 rounded-full ring-2 ring-emerald-400/60" />
                </span>
              </div>
              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-black/50 px-2.5 py-1.5 text-xs text-white backdrop-blur">
                <Mic className="h-3.5 w-3.5 text-emerald-400" />
                Анна Соколова · учитель
              </div>
              <div className="absolute right-3 top-3 rounded-md bg-black/40 px-2 py-1 text-[10px] font-medium text-slate-200 backdrop-blur">
                HD · 1080p
              </div>
            </div>

            {/* Плитки учеников */}
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-1">
              {STUDENTS.map((student) => (
                <div
                  key={student.initials}
                  className={cn(
                    "relative aspect-video overflow-hidden rounded-2xl bg-gradient-to-br sm:aspect-auto sm:h-full",
                    student.tone,
                  )}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold text-white ring-1 ring-white/15 backdrop-blur sm:h-12 sm:w-12 sm:text-sm">
                      {student.initials}
                    </span>
                  </div>

                  <div className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[10px] text-white/90">
                    {student.muted ? (
                      <MicOff className="h-3 w-3 text-red-300" />
                    ) : (
                      <Mic className="h-3 w-3 text-emerald-300" />
                    )}
                    <span className="hidden sm:inline">{student.name}</span>
                  </div>

                  {student.hand && (
                    <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/90 text-ink-950">
                      <Hand className="h-3.5 w-3.5" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Панель управления */}
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
            <ControlButton icon={<Mic className="h-4 w-4" />} label="Микрофон" />
            <ControlButton icon={<Video className="h-4 w-4" />} label="Камера" />
            <ControlButton icon={<MonitorUp className="h-4 w-4" />} label="Демонстрация экрана" active />
            <ControlButton icon={<Hand className="h-4 w-4" />} label="Поднять руку" />
            <ControlButton icon={<MessageSquare className="h-4 w-4" />} label="Чат" badge="3" />
            <button
              type="button"
              aria-label="Завершить урок"
              className="inline-flex h-10 w-14 items-center justify-center rounded-xl bg-red-500/90 text-white transition hover:bg-red-500"
            >
              <PhoneOff className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Плавающая карточка ИИ-доски */}
      <div className="absolute -bottom-10 -left-2 hidden w-72 animate-fade-up rounded-2xl border border-white/10 bg-ink-850/90 p-4 shadow-2xl backdrop-blur-xl [animation-delay:600ms] sm:block lg:-left-16">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-gradient">
            <Sparkles className="h-4 w-4 text-white" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">ИИ-доска</p>
            <p className="text-[11px] text-slate-400">GPT-4o Vision · разбор за 1,2 с</p>
          </div>
        </div>

        <div className="mt-3 space-y-1.5 rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          <p className="text-slate-500">{"// распознано с доски"}</p>
          <p className="text-white">x² + 5x + 6 = 0</p>
          <p className="text-brand-300">(x + 2)(x + 3) = 0</p>
          <p className="text-emerald-300">x₁ = −2 · x₂ = −3</p>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
          <VideoOff className="h-3 w-3" />
          Отправлено в чат и в конспект урока
        </p>
      </div>

      {/* Плавающая карточка расписания */}
      <div className="absolute -right-2 -top-8 hidden w-56 animate-fade-up rounded-2xl border border-white/10 bg-ink-850/90 p-4 shadow-2xl backdrop-blur-xl [animation-delay:800ms] lg:block lg:-right-14">
        <p className="text-[11px] uppercase tracking-wider text-slate-500">Следующий урок</p>
        <p className="mt-1 text-sm font-semibold text-white">Геометрия · 8 «Б»</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Четверг · 11:30 – 12:15
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-2/3 rounded-full bg-brand-gradient" />
        </div>
        <p className="mt-1.5 text-[10px] text-slate-500">До начала: 24 минуты</p>
      </div>
    </div>
  );
}

function ControlButton({
  icon,
  label,
  active = false,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex h-10 w-10 items-center justify-center rounded-xl border transition",
        active
          ? "border-brand-400/40 bg-brand-500/20 text-white"
          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white",
      )}
    >
      {icon}
      {badge && (
        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
