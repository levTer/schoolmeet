import Link from "next/link";
import { BellRing, CalendarClock, ClipboardCheck, Clock3, Video } from "lucide-react";

import { DeadlineBadge } from "@/components/homework/deadline-badge";
import { formatDeadline } from "@/lib/homework-rules";
import type { ReviewQueue, UrgentHomeworkItem } from "@/lib/homework";
import { GRADE_LABELS, type GradeCode, type NextLesson } from "@/lib/schedule-rules";
import type { Schedule } from "@/types";
import { cn } from "@/lib/utils";

const WIDGET_SHELL = "ring-gradient glass-card animate-fade-up flex h-full flex-col p-5";
const WIDGET_TITLE = "flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400";

const DAY_SHORT = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

/** 95 → «1 ч 35 мин», 12 → «12 мин». */
export function formatUntil(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return hours > 0 ? `${hours} ч ${rest} мин` : `${rest} мин`;
}

/* -------------------------------------------------------------------------- */
/* «Следующий урок»                                                           */
/* -------------------------------------------------------------------------- */

export function NextLessonWidget({ next, live }: { next: NextLesson<Schedule> | null; live: Schedule | null }) {
  const lesson = live ?? next?.lesson ?? null;

  return (
    <section className={WIDGET_SHELL} aria-labelledby="widget-next-lesson">
      <h2 id="widget-next-lesson" className={WIDGET_TITLE}>
        <CalendarClock className="h-4 w-4" />
        Следующий урок
      </h2>

      {!lesson ? (
        <p className="mt-4 text-sm text-slate-400">Ближайших уроков нет. Расписание появится здесь, когда его составит школа.</p>
      ) : (
        <div className="mt-4 flex flex-1 flex-col">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl"
              style={{ background: `linear-gradient(135deg, ${lesson.subject?.color ?? "#6366f1"}E6, ${lesson.subject?.color ?? "#6366f1"}55)` }}
            >
              {lesson.subject?.emoji ?? "📚"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-white">{lesson.subject?.name ?? "Урок"}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {DAY_SHORT[lesson.dayOfWeek]} · {lesson.startTime}–{lesson.endTime} · {GRADE_LABELS[lesson.grade as GradeCode]}
              </p>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-300">
            {live ? (
              <span className="inline-flex items-center gap-2 text-rose-200">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
                </span>
                Идёт сейчас
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5 text-slate-500" />
                До следующего урока: {formatUntil(next?.minutesUntil ?? 0)}
              </span>
            )}
          </p>

          <div className="mt-auto pt-5">
            <Link
              href={`/meeting/${encodeURIComponent(lesson.meetingCode)}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01]"
            >
              <Video className="h-4 w-4" />
              Войти в урок
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* «Срочные ДЗ»                                                               */
/* -------------------------------------------------------------------------- */

export function UrgentHomeworkWidget({ items, role }: { items: UrgentHomeworkItem[]; role: string }) {
  return (
    <section className={WIDGET_SHELL} aria-labelledby="widget-urgent-homework">
      <h2 id="widget-urgent-homework" className={WIDGET_TITLE}>
        <BellRing className="h-4 w-4" />
        {role === "STUDENT" ? "Срочные ДЗ" : "Ближайшие дедлайны"}
      </h2>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">
          {role === "STUDENT" ? "Несданных заданий нет." : "Активных заданий с будущими сроками нет."}
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/homework/${item.id}`}
                className="block rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 transition hover:bg-white/[0.06]"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-white">
                    <span aria-hidden>{item.subjectEmoji} </span>
                    {item.title}
                  </p>
                  <span className="shrink-0 text-[11px] text-slate-500">{item.note}</span>
                </div>
                <div className="mt-2">
                  <DeadlineBadge deadline={item.deadline} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* «Нужно проверить»                                                          */
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

      {!isStudent && queue.items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {queue.items.map((item) => (
            <li key={item.submissionId} className="text-xs text-slate-300">
              <Link href={`/homework/${item.homeworkId}`} className="transition hover:text-white">
                <span className="text-slate-100">{item.studentName}</span> · {item.homeworkTitle}
                <span className="block text-[11px] text-slate-500">сдано {formatDeadline(item.submittedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
