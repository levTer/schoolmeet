"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Clock3, Video } from "lucide-react";

import { GRADE_LABELS, type GradeCode, type NextLesson } from "@/lib/schedule-rules";
import type { Schedule } from "@/types";

const DAY_SHORT = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

/** MM:SS или HH:MM:SS — компактный обратный отсчёт до урока. */
function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

function formatUntil(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)} д ${hours % 24} ч`;
  return hours > 0 ? `${hours} ч ${rest} мин` : `${rest} мин`;
}

/**
 * «Следующий урок» — компактная карточка для однoэкранного мобильного кабинета.
 *
 * Занимает ~150px по высоте: одна строка метаданных, предмет и кнопка входа.
 * Обратный отсчёт обновляется раз в секунду; кнопка подсвечивается акцентом,
 * когда урок уже идёт или начинается в течение пяти минут.
 */
export function NextLessonCompact({
  next,
  live,
}: {
  next: NextLesson<Schedule> | null;
  live: Schedule | null;
}) {
  const lesson = live ?? next?.lesson ?? null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const countdown = useMemo(() => {
    if (!next || live) return null;
    const secondsLeft = next.minutesUntil * 60 - (now % 60000) / 1000;
    return Math.max(0, secondsLeft);
  }, [next, live, now]);

  const isLive = Boolean(live);
  const isActive = isLive || (next !== null && next.minutesUntil <= 5);

  if (!lesson) {
    return (
      <section className="card p-3" aria-labelledby="mobile-next-lesson">
        <h2 id="mobile-next-lesson" className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <CalendarClock className="h-3.5 w-3.5" />
          Следующий урок
        </h2>
        <p className="mt-1.5 text-sm text-slate-300">Ближайших уроков нет</p>
        <p className="mt-0.5 text-xs text-slate-500">Расписание появится, когда его составит школа.</p>
      </section>
    );
  }

  return (
    <section className="card p-3" aria-labelledby="mobile-next-lesson">
      <div className="flex items-center justify-between gap-2">
        <h2 id="mobile-next-lesson" className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <CalendarClock className="h-3.5 w-3.5" />
          Следующий урок
        </h2>

        {isLive ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-rose-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
            Идёт сейчас
          </span>
        ) : countdown !== null ? (
          <span className="font-mono text-xs font-semibold tabular-nums text-brand-300">
            {formatCountdown(countdown)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <Clock3 className="h-3 w-3" />
            {formatUntil(next?.minutesUntil ?? 0)}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2.5">
        <span
          aria-hidden
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-base"
          style={{ backgroundColor: `${lesson.subject?.color ?? "#6366f1"}22` }}
        >
          {lesson.subject?.emoji ?? "📚"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {lesson.subject?.name ?? "Урок"}
          </p>
          <p className="truncate text-[11px] text-slate-400">
            {DAY_SHORT[lesson.dayOfWeek]} · {lesson.startTime}–{lesson.endTime}
            {lesson.room ? ` · каб. ${lesson.room}` : ""} · {GRADE_LABELS[lesson.grade as GradeCode]}
          </p>
        </div>
      </div>

      <Link
        href={`/meeting/${encodeURIComponent(lesson.meetingCode)}`}
        className={
          isActive
            ? "mt-2.5 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-500 text-sm font-medium text-canvas transition hover:bg-brand-400"
            : "mt-2.5 flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-sm font-medium text-white transition hover:bg-white/[0.08]"
        }
      >
        <Video className="h-4 w-4" />
        {isActive ? "Войти в урок" : "Перейти к уроку"}
      </Link>
    </section>
  );
}
