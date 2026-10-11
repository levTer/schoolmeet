"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BellRing,
  CalendarClock,
  ClipboardCheck,
  Clock3,
  FileCheck,
  Loader2,
  Plus,
  Rocket,
  Video,
} from "lucide-react";

import { DeadlineBadge } from "@/components/homework/deadline-badge";
import { formatDeadline } from "@/lib/homework-rules";
import type { ReviewQueue, UrgentHomeworkItem } from "@/lib/homework";
import { GRADE_LABELS, type GradeCode, type NextLesson } from "@/lib/schedule-rules";
import type { Schedule } from "@/types";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Общие стили виджетов                                                       */
/* -------------------------------------------------------------------------- */

const WIDGET_SHELL = "ring-gradient glass-card animate-fade-up flex h-full flex-col p-5";
const WIDGET_TITLE = "flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400";

const DAY_SHORT = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

export function formatUntil(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const restH = hours % 24;
    return `${days} д ${restH} ч`;
  }
  return hours > 0 ? `${hours} ч ${rest} мин` : `${rest} мин`;
}

/** Форматирует секунды в MM:SS или HH:MM:SS для обратного отсчёта. */
function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

/* -------------------------------------------------------------------------- */
/* «Следующий урок» с обратным отсчётом и пульсирующей кнопкой                */
/* -------------------------------------------------------------------------- */

export function NextLessonWidgetLive({
  next,
  live,
}: {
  next: NextLesson<Schedule> | null;
  live: Schedule | null;
}) {
  const lesson = live ?? next?.lesson ?? null;
  const [now, setNow] = useState(() => Date.now());

  /* Тикаем каждую секунду для обратного отсчёта. */
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const countdown = useMemo(() => {
    if (!next || live) return null;
    const secondsLeft = next.minutesUntil * 60 - (now % 60000) / 1000;
    return Math.max(0, secondsLeft);
  }, [next, live, now]);

  /* Кнопка активна: урок идёт прямо сейчас ИЛИ до начала ≤ 5 минут. */
  const isButtonActive = Boolean(live) || (next !== null && next.minutesUntil <= 5);

  if (!lesson) {
    return (
      <section className={WIDGET_SHELL} aria-labelledby="widget-next-lesson">
        <h2 id="widget-next-lesson" className={WIDGET_TITLE}>
          <CalendarClock className="h-4 w-4" />
          Следующий урок
        </h2>
        <p className="mt-4 text-sm text-slate-400">
          Ближайших уроков нет. Расписание появится здесь, когда его составит школа.
        </p>
      </section>
    );
  }

  return (
    <section className={WIDGET_SHELL} aria-labelledby="widget-next-lesson">
      <h2 id="widget-next-lesson" className={WIDGET_TITLE}>
        <CalendarClock className="h-4 w-4" />
        Следующий урок
      </h2>

      <div className="mt-4 flex flex-1 flex-col">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl"
            style={{
              background: `linear-gradient(135deg, ${lesson.subject?.color ?? "#6366f1"}E6, ${lesson.subject?.color ?? "#6366f1"}55)`,
            }}
          >
            {lesson.subject?.emoji ?? "📚"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">
              {lesson.subject?.name ?? "Урок"}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {DAY_SHORT[lesson.dayOfWeek]} · {lesson.startTime}–{lesson.endTime} ·{" "}
              {GRADE_LABELS[lesson.grade as GradeCode]}
            </p>
          </div>
        </div>

        {/* Обратный отсчёт или «идёт сейчас» */}
        <div className="mt-4">
          {live ? (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-rose-200">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-400" />
              </span>
              Идёт сейчас
            </span>
          ) : countdown !== null ? (
            <div>
              <p className="text-xs text-slate-400">
                До урока <span className="text-white">{lesson.subject?.name ?? "Урока"}</span> осталось
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-gradient">
                {formatCountdown(countdown)}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatUntil(next?.minutesUntil ?? 0)}
              </p>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-300">
              <Clock3 className="h-3.5 w-3.5 text-slate-500" />
              До следующего: {formatUntil(next?.minutesUntil ?? 0)}
            </span>
          )}
        </div>

        <div className="mt-auto pt-5">
          <Link
            href={`/meeting/${encodeURIComponent(lesson.meetingCode)}`}
            className={cn(
              "relative inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition",
              isButtonActive
                ? "bg-brand-gradient shadow-glow hover:scale-[1.02] animate-pulse-glow"
                : "bg-brand-gradient/60 hover:bg-brand-gradient hover:shadow-glow",
            )}
          >
            <Video className="h-4 w-4" />
            {live ? "Войти в урок" : isButtonActive ? "Войти в урок" : "Перейти к уроку"}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* «Срочные ДЗ» — топ-3 с индикаторами дедлайнов                             */
/* -------------------------------------------------------------------------- */

const DEADLINE_DOT: Record<string, string> = {
  green: "bg-emerald-400",
  yellow: "bg-amber-400",
  red: "bg-rose-400",
  gray: "bg-slate-500",
};

function getDeadlineDot(deadline: string): string {
  const diffMs = new Date(deadline).getTime() - Date.now();
  const hours = diffMs / (1000 * 60 * 60);
  if (hours < 0) return "gray";
  if (hours < 24) return "red";
  if (hours < 72) return "yellow";
  return "green";
}

export function UrgentHomeworkWidget({ items, role }: { items: UrgentHomeworkItem[]; role: string }) {
  const top3 = items.slice(0, 3);

  return (
    <section className={WIDGET_SHELL} aria-labelledby="widget-urgent-homework">
      <h2 id="widget-urgent-homework" className={WIDGET_TITLE}>
        <BellRing className="h-4 w-4" />
        {role === "STUDENT" ? "Срочные ДЗ" : "Ближайшие дедлайны"}
      </h2>

      {top3.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">
          {role === "STUDENT" ? "Несданных заданий нет. 🎉" : "Активных заданий с будущими сроками нет."}
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {top3.map((item) => {
            const dot = getDeadlineDot(item.deadline);
            return (
              <li key={item.id}>
                <Link
                  href={`/homework/${item.id}`}
                  className="group flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 transition hover:border-brand-400/20 hover:bg-white/[0.06]"
                >
                  <span
                    className={cn(
                      "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                      DEADLINE_DOT[dot] ?? "bg-slate-500",
                    )}
                    aria-label={`Индикатор: ${dot === "red" ? "срочно" : dot === "yellow" ? "скоро" : "есть время"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white group-hover:text-brand-200">
                      <span aria-hidden>{item.subjectEmoji} </span>
                      {item.title}
                    </p>
                    <div className="mt-1.5">
                      <DeadlineBadge deadline={item.deadline} />
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 3 && (
        <Link
          href="/homework"
          className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-300 transition hover:text-brand-200"
        >
          Ещё {items.length - 3} заданий →
        </Link>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* «Нужно проверить» — для учителя с быстрыми кнопками                        */
/* -------------------------------------------------------------------------- */

export function ReviewQueueWidget({ queue, role }: { queue: ReviewQueue; role: string }) {
  const isStudent = role === "STUDENT";

  return (
    <section className={cn(WIDGET_SHELL)} aria-labelledby="widget-review-queue">
      <h2 id="widget-review-queue" className={WIDGET_TITLE}>
        <ClipboardCheck className="h-4 w-4" />
        {isStudent ? "На проверке" : "Нужно проверить"}
      </h2>

      <p className="mt-4 text-3xl font-semibold tabular-nums text-white">{queue.count}</p>
      <p className="mt-1 text-xs text-slate-400">
        {isStudent ? "ваших работ ждут оценки учителя" : "работ учеников ждут проверки"}
      </p>

      {!isStudent && queue.count > 0 && (
        <Link
          href="/homework"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-gradient/80 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-gradient hover:scale-[1.02]"
        >
          <FileCheck className="h-4 w-4" />
          Перейти к проверке
        </Link>
      )}

      {!isStudent && queue.items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {queue.items.slice(0, 3).map((item) => (
            <li key={item.submissionId} className="text-xs text-slate-300">
              <Link
                href={`/homework/${item.homeworkId}`}
                className="block rounded-lg px-2 py-1.5 transition hover:bg-white/5 hover:text-white"
              >
                <span className="text-slate-100">{item.studentName}</span> · {item.homeworkTitle}
                <span className="block text-[11px] text-slate-500">
                  сдано {formatDeadline(item.submittedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* «Начать внеплановый урок» — быстрое действие для учителя                   */
/* -------------------------------------------------------------------------- */

export function QuickLessonButton({ role }: { role: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);

    try {
      const title = `Внеплановый урок ${new Date().toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}`;

      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json?.error ?? "Не удалось создать урок");
      }

      const code = json.data.meeting.meetingCode;
      router.push(`/meeting/${encodeURIComponent(code)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания урока");
      setCreating(false);
    }
  }, [creating, router]);

  if (role === "STUDENT") return null;

  return (
    <section className="ring-gradient glass-card animate-fade-up p-5">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <Rocket className="h-4 w-4" />
        Быстрое действие
      </h2>

      <p className="mt-3 text-sm text-slate-300">
        Запустите внеплановый урок одним нажатием. Код встречи сгенерируется автоматически.
      </p>

      <button
        type="button"
        onClick={handleCreate}
        disabled={creating}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient px-4 py-3 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.02] disabled:opacity-60"
      >
        {creating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {creating ? "Создаём урок…" : "Начать внеплановый урок"}
      </button>

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </section>
  );
}
