"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, LogIn, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { LessonModal } from "@/components/schedule/lesson-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { useSchoolClock } from "@/hooks/useSchoolClock";
import { apiRequest } from "@/lib/client-api";
import {
  findLiveLesson,
  findNextLesson,
  formatMinutes,
  getLessonStatus,
  parseTime,
  SCHOOL_DAY_END,
  SCHOOL_DAY_START,
  GRADE_LABELS,
  type GradeCode,
  type LessonStatus,
  type SchoolClock,

} from "@/lib/schedule-rules";
import { cn } from "@/lib/utils";
import type { SchoolClassOption } from "@/lib/schools";
import { DAY_LABELS, DAY_SHORT_LABELS, type DayOfWeek, type Role, type Schedule, type Subject } from "@/types";

/** Масштаб сетки: пикселей в минуте. */
const PX_PER_MINUTE = 1.3;
/** Сетка по умолчанию, если уроков мало: 08:00–16:00. */
const DEFAULT_RANGE: [number, number] = [8 * 60, 16 * 60];
const WEEK_DAYS: DayOfWeek[] = [1, 2, 3, 4, 5, 6];

type ViewMode = "day" | "week";

export interface ScheduleViewer {
  id: string;
  role: Role;
  grade: GradeCode | null;
  classId: string | null;
}

interface ScheduleBoardProps {
  lessons: Schedule[];
  subjects: Subject[];
  classes: SchoolClassOption[];
  viewer: ScheduleViewer;
}

/* -------------------------------------------------------------------------- */
/* Раскладка                                                                   */
/* -------------------------------------------------------------------------- */

/** Диапазон сетки в минутах: от часа до часа, с запасом вокруг всех уроков. */
function computeRange(lessons: Schedule[]): [number, number] {
  let start = DEFAULT_RANGE[0];
  let end = DEFAULT_RANGE[1];
  for (const lesson of lessons) {
    const from = parseTime(lesson.startTime);
    const to = parseTime(lesson.endTime);
    if (from !== null) start = Math.min(start, from);
    if (to !== null) end = Math.max(end, to);
  }
  return [Math.max(SCHOOL_DAY_START, Math.floor(start / 60) * 60), Math.min(SCHOOL_DAY_END, Math.ceil(end / 60) * 60)];
}

interface PlacedLesson {
  lesson: Schedule;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/**
 * Раскладывает уроки одного дня по «дорожкам», чтобы наложения (например, разные классы
 * у администратора) были видны рядом, а не друг под другом.
 */
function layoutDay(lessons: Schedule[], rangeStart: number): PlacedLesson[] {
  const sorted = [...lessons].sort((a, b) => (parseTime(a.startTime) ?? 0) - (parseTime(b.startTime) ?? 0));
  const laneEnds: number[] = [];

  const placed = sorted.map((lesson) => {
    const start = parseTime(lesson.startTime) ?? rangeStart;
    const end = parseTime(lesson.endTime) ?? start + 45;
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    return {
      lesson,
      lane,
      lanes: 0,
      top: (start - rangeStart) * PX_PER_MINUTE,
      height: Math.max((end - start) * PX_PER_MINUTE - 4, 30),
    };
  });

  const lanes = Math.max(1, laneEnds.length);
  return placed.map((item) => ({ ...item, lanes }));
}

function countdownLabel(minutesUntil: number, lesson: Schedule): string {
  if (minutesUntil < 24 * 60) return `До следующего урока: ${minutesUntil} мин`;
  const day = DAY_LABELS[lesson.dayOfWeek as DayOfWeek].toLowerCase();
  return `Следующий урок: ${day}, ${lesson.startTime}`;
}

/* -------------------------------------------------------------------------- */
/* Компонент                                                                   */
/* -------------------------------------------------------------------------- */

export function ScheduleBoard({ lessons, subjects, classes, viewer }: ScheduleBoardProps) {
  const router = useRouter();
  const schoolNow = useSchoolClock();
  const clock: SchoolClock | null = schoolNow?.clock ?? null;

  const [mode, setMode] = useState<ViewMode>("week");
  const [dayOverride, setDayOverride] = useState<DayOfWeek | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canEdit = viewer.role === "TEACHER" || viewer.role === "ADMIN";
  const activeDay: DayOfWeek = dayOverride ?? (clock && clock.dayOfWeek !== 7 ? clock.dayOfWeek : 1);

  const nextInfo = clock ? findNextLesson(lessons, clock) : null;
  const liveLesson = clock ? findLiveLesson(lessons, clock) : null;
  const entryLesson = liveLesson ?? nextInfo?.lesson ?? null;

  const range = useMemo(() => computeRange(lessons), [lessons]);
  const [rangeStart, rangeEnd] = range;
  const gridHeight = (rangeEnd - rangeStart) * PX_PER_MINUTE;

  const lessonsByDay = useMemo(() => {
    const map = new Map<number, Schedule[]>();
    for (const lesson of lessons) {
      const bucket = map.get(lesson.dayOfWeek) ?? [];
      bucket.push(lesson);
      map.set(lesson.dayOfWeek, bucket);
    }
    return map;
  }, [lessons]);

  const visibleDays: DayOfWeek[] = mode === "week"
    ? [...WEEK_DAYS, ...((lessonsByDay.get(7)?.length ?? 0) > 0 ? [7 as DayOfWeek] : [])]
    : [activeDay];

  const columns = visibleDays.map((day) => ({
    day,
    placed: layoutDay(lessonsByDay.get(day) ?? [], rangeStart),
  }));

  const nowTop =
    clock && clock.minutes >= rangeStart && clock.minutes <= rangeEnd
      ? (clock.minutes - rangeStart) * PX_PER_MINUTE
      : null;

  const shiftDay = (delta: number) => {
    const next = ((((activeDay - 1 + delta) % 7) + 7) % 7) + 1;
    setDayOverride(next as DayOfWeek);
  };

  const handleDelete = useCallback(
    async (lesson: Schedule) => {
      if (!window.confirm(`Удалить урок «${lesson.subject?.name ?? "урок"}» из расписания?`)) return;
      setDeletingId(lesson.id);
      const result = await apiRequest<{ deleted: boolean }>(`/api/schedule/${lesson.id}`, { method: "DELETE" });
      setDeletingId(null);
      if (result.ok) {
        toast.success("Урок удалён из расписания");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    },
    [router],
  );

  const onCreated = useCallback(() => router.refresh(), [router]);

  const hasNoLessons = lessons.length === 0;
  const studentWithoutGrade = viewer.role === "STUDENT" && !viewer.classId;

  return (
    <section aria-label="Расписание уроков" className="space-y-5">
      {/* Панель управления */}
      <div className="glass-card flex flex-wrap items-center gap-3 p-3 sm:p-4">
        <div role="tablist" aria-label="Режим отображения" className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
          {(["day", "week"] as const).map((value) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm transition",
                mode === value ? "bg-brand-500/25 text-white shadow-inner-top ring-1 ring-brand-400/30" : "text-slate-400 hover:text-white",
              )}
            >
              {value === "day" ? "День" : "Неделя"}
            </button>
          ))}
        </div>

        {mode === "day" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftDay(-1)}
              aria-label="Предыдущий день"
              className="rounded-full p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[8.5rem] text-center text-sm font-medium text-white">{DAY_LABELS[activeDay]}</span>
            <button
              type="button"
              onClick={() => shiftDay(1)}
              aria-label="Следующий день"
              className="rounded-full p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex w-full flex-wrap items-center gap-3 sm:ml-auto sm:w-auto">
          {/* Таймер до следующего урока */}
          <div className="flex items-center gap-2 rounded-full border border-accent-400/25 bg-accent-500/10 px-3.5 py-2 text-sm text-accent-200">
            <Clock3 className="h-4 w-4 shrink-0" />
            {!clock ? (
              <Skeleton className="h-4 w-44" />
            ) : liveLesson ? (
              <span>
                Идёт урок · <span className="font-medium text-white">{liveLesson.subject?.name}</span>
              </span>
            ) : nextInfo ? (
              <span>{countdownLabel(nextInfo.minutesUntil, nextInfo.lesson)}</span>
            ) : (
              <span>Уроков больше нет</span>
            )}
          </div>

          {entryLesson ? (
            <Link
              href={`/meeting/${entryLesson.meetingCode}`}
              className="inline-flex items-center gap-2 rounded-full bg-brand-gradient px-5 py-2 text-sm font-semibold text-brand-contrast shadow-glow transition hover:scale-[1.02]"
            >
              <LogIn className="h-4 w-4" />
              Войти
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-white/10 px-5 py-2 text-sm text-slate-500"
            >
              <LogIn className="h-4 w-4" />
              Войти
            </span>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              aria-label="Добавить урок"
              className="inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-brand-500/15 px-4 py-2 text-sm font-medium text-brand-100 transition hover:bg-brand-500/25"
            >
              <Plus className="h-4 w-4" />
              Урок
            </button>
          )}
        </div>
      </div>

      {studentWithoutGrade && (
        <div className="glass-card border-amber-400/25 bg-amber-500/10 p-5 text-sm text-amber-100">
          Класс ещё не назначен, поэтому расписание пустое. Обратитесь к администратору школы.
        </div>
      )}

      {/* Сетка */}
      {hasNoLessons && !studentWithoutGrade ? (
        <div className="glass-card flex flex-col items-center gap-3 p-10 text-center">
          <CalendarDays className="h-8 w-8 text-brand-300" />
          <p className="text-white">Уроков пока нет</p>
          <p className="max-w-sm text-sm text-slate-400">
            {canEdit ? "Добавьте первый урок кнопкой «Урок» — он сразу получит комнату для входа." : "Как только учитель добавит уроки, они появятся здесь."}
          </p>
        </div>
      ) : (
        <div className="glass-card overflow-x-auto p-3 sm:p-4">
          <div style={{ minWidth: mode === "week" ? 720 : 280 }}>
            {/* Шапка дней */}
            <div
              className="grid border-b border-white/5 pb-2"
              style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(0, 1fr))` }}
            >
              <div />
              {columns.map(({ day }) => {
                const isToday = clock?.dayOfWeek === day;
                return (
                  <div key={day} className="px-2 text-center">
                    <p className={cn("text-xs uppercase tracking-wider", isToday ? "text-accent-300" : "text-slate-400")}>
                      {DAY_SHORT_LABELS[day]}
                    </p>
                    {mode === "day" && (
                      <p className="text-sm font-medium text-white">{DAY_LABELS[day]}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Тело сетки */}
            <div
              className="grid"
              style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(0, 1fr))`, height: gridHeight }}
            >
              {/* Подписи часов */}
              <div className="relative">
                {hourMarks(rangeStart, rangeEnd).map((minute) => (
                  <span
                    key={minute}
                    className="absolute -translate-y-1/2 pr-2 text-right text-[11px] text-slate-500"
                    style={{ top: (minute - rangeStart) * PX_PER_MINUTE, right: 0 }}
                  >
                    {formatMinutes(minute)}
                  </span>
                ))}
              </div>

              {columns.map(({ day, placed }) => {
                const isToday = clock?.dayOfWeek === day;
                return (
                  <div key={day} className="relative border-l border-white/5">
                    {hourMarks(rangeStart, rangeEnd).map((minute) => (
                      <div
                        key={minute}
                        className="absolute inset-x-0 border-t border-white/[0.06]"
                        style={{ top: (minute - rangeStart) * PX_PER_MINUTE }}
                      />
                    ))}

                    {isToday && nowTop !== null && (
                      <div
                        aria-label="Текущее время"
                        className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                        style={{ top: nowTop }}
                      >
                        <span className="-ml-1 h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.9)]" />
                        <span className="h-[2px] flex-1 bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]" />
                      </div>
                    )}

                    {placed.map((item) => (
                      <LessonCard
                        key={item.lesson.id}
                        item={item}
                        status={clock && isToday ? getLessonStatus(item.lesson, clock) : null}
                        canDelete={canEdit && (viewer.role === "ADMIN" || item.lesson.teacherId === viewer.id)}
                        deleting={deletingId === item.lesson.id}
                        onDelete={handleDelete}
                        showGrade={viewer.role !== "STUDENT"}
                        showTeacher={viewer.role !== "TEACHER"}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {canEdit && (
        <LessonModal
          open={modalOpen}
          subjects={subjects}
          classes={classes}
          defaultDay={activeDay}
          onClose={() => setModalOpen(false)}
          onCreated={onCreated}
        />
      )}
    </section>
  );
}

function hourMarks(start: number, end: number): number[] {
  const marks: number[] = [];
  for (let minute = start; minute <= end; minute += 60) marks.push(minute);
  return marks;
}

/* -------------------------------------------------------------------------- */
/* Карточка урока                                                              */
/* -------------------------------------------------------------------------- */

interface LessonCardProps {
  item: PlacedLesson;
  status: LessonStatus | null;
  canDelete: boolean;
  deleting: boolean;
  onDelete: (lesson: Schedule) => void;
  showGrade: boolean;
  showTeacher: boolean;
}

function LessonCard({ item, status, canDelete, deleting, onDelete, showGrade, showTeacher }: LessonCardProps) {
  const { lesson } = item;
  const color = lesson.subject?.color ?? "#a855f7";
  const isLive = status === "live";
  const isFinished = status === "finished";
  const widthPercent = 100 / item.lanes;

  return (
    <article
      aria-label={`${lesson.subject?.name ?? "Урок"}, ${lesson.startTime}–${lesson.endTime}`}
      className={cn(
        "absolute z-10 overflow-hidden rounded-2xl border p-2.5 text-white shadow-lg transition duration-300",
        isLive && "animate-pulse-soft",
        isFinished && "opacity-60 saturate-50",
      )}
      style={{
        top: item.top + 2,
        height: item.height,
        left: `calc(${item.lane * widthPercent}% + 2px)`,
        width: `calc(${widthPercent}% - 4px)`,
        background: `linear-gradient(135deg, ${color}F0 0%, ${color}8C 55%, ${color}40 100%)`,
        borderColor: isLive ? "rgba(255,255,255,0.7)" : `${color}80`,
        boxShadow: isLive ? `0 0 0 1px rgba(255,255,255,0.4), 0 14px 40px -14px ${color}` : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-1.5">
        <p className="min-w-0 truncate text-xs font-semibold leading-tight">
          <span aria-hidden className="mr-1">{lesson.subject?.emoji}</span>
          {lesson.subject?.name}
        </p>
        <StatusBadge status={status} />
      </div>

      <p className="mt-0.5 font-mono text-[11px] text-white/85">
        {lesson.startTime}–{lesson.endTime}
      </p>

      {item.height > 56 && (
        <p className="mt-1 truncate text-[11px] text-white/80">
          {[showGrade ? lesson.className ?? GRADE_LABELS[lesson.grade] : null, showTeacher ? lesson.teacher?.name : null, lesson.room]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
        {(status === "live" || status === "soon") && (
          <Link
            href={`/meeting/${lesson.meetingCode}`}
            className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-ink-950 transition hover:bg-white"
          >
            Войти
          </Link>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(lesson)}
            disabled={deleting}
            aria-label="Удалить урок"
            className="rounded-full bg-black/25 p-1 text-white/80 transition hover:bg-rose-500/70 hover:text-white disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: LessonStatus | null }) {
  if (status === "live") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
        </span>
        Идёт сейчас
      </span>
    );
  }
  if (status === "soon") {
    return (
      <span className="shrink-0 rounded-full bg-amber-300/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-950">
        Скоро
      </span>
    );
  }
  if (status === "finished") {
    return <span className="shrink-0 rounded-full bg-black/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">Завершён</span>;
  }
  return null;
}

