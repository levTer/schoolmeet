"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, PhoneOff, Radio, Video } from "lucide-react";
import { toast } from "sonner";

import { Modal } from "@/components/ui/modal";
import { canManageLessonEnd } from "@/lib/call-rules";
import type { LiveLesson } from "@/lib/live-lesson-rules";
import type { Role } from "@/types";

const LESSON_ENDED_DOM_EVENT = "eduflow:lesson-ended";

export interface LiveLessonCardProps {
  lesson: LiveLesson;
  currentUser?: { id: string; role: Role } | null;
}

/**
 * Крупная карточка «🔴 ПРЯМО СЕЙЧАС ИДЁТ УРОК» — самый верх кабинета.
 *
 * Зачем: на открытый урок ученик должен попадать в один клик, без пароля,
 * кода комнаты и ссылки. Кнопка ведёт на `/meeting?room=<код>`, а страница
 * `/meeting` сразу редиректит в видеокомнату `/meeting/<код>` (доступ всё
 * равно проверяется сервером по сессии и школе — открытого доступа нет).
 *
 * Ведущий урока (`currentUser.id === lesson.hostId`) и администратор школы
 * (`currentUser.role === "ADMIN"`) дополнительно видят кнопку «🔴 Завершить урок»,
 * чтобы закрыть зависший или внеплановый урок прямо из кабинета.
 */
export function LiveLessonCard({ lesson, currentUser }: LiveLessonCardProps) {
  const router = useRouter();
  const dialogId = useId();
  const titleId = `${dialogId}-end-lesson-title`;
  const descriptionId = `${dialogId}-end-lesson-description`;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    setEnded(false);
    setConfirmOpen(false);
    setEnding(false);
  }, [lesson.meetingId, lesson.meetingCode]);

  useEffect(() => {
    const onEnded = (event: Event) => {
      const detail = (event as CustomEvent<{ meetingCode?: string }>).detail;
      if (detail?.meetingCode === lesson.meetingCode) {
        setEnded(true);
        setConfirmOpen(false);
      }
    };
    window.addEventListener(LESSON_ENDED_DOM_EVENT, onEnded);
    return () => window.removeEventListener(LESSON_ENDED_DOM_EVENT, onEnded);
  }, [lesson.meetingCode]);

  if (ended) return null;

  const canEnd = canManageLessonEnd(currentUser, lesson);
  const timeLabel =
    lesson.startTime && lesson.endTime ? `${lesson.startTime}–${lesson.endTime}` : null;
  const details = [lesson.teacherName, timeLabel].filter(Boolean).join(" · ");

  const handleConfirmEnd = async () => {
    if (ending) return;
    const target = lesson.meetingId ?? lesson.meetingCode;
    if (!target) return;

    setEnding(true);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(target)}/end`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        toast.error(payload?.error ?? "Не удалось завершить урок");
        setEnding(false);
        return;
      }

      setConfirmOpen(false);
      setEnding(false);
      setEnded(true);
      window.dispatchEvent(
        new CustomEvent(LESSON_ENDED_DOM_EVENT, { detail: { meetingCode: lesson.meetingCode } }),
      );
      toast.success("Урок завершён для всех участников");
      router.refresh();
    } catch {
      setEnding(false);
      toast.error("Нет связи с сервером. Попробуйте ещё раз.");
    }
  };

  return (
    <>
      <section
        aria-labelledby="live-lesson-title"
        className="live-lesson-card ring-gradient relative overflow-hidden rounded-2xl border border-emerald-400/40 bg-emerald-500/[0.12] p-3.5 shadow-glow animate-fade-up md:p-4"
      >
        {/* Мягкое свечение под карточкой: «яркая» плашка, но без кислотного фона. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent"
        />

        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.9)]" />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-200">
            🔴 Прямо сейчас идёт урок
          </p>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-200">
            <Radio className="h-3 w-3" />
            Live
          </span>
        </div>

        <h2
          id="live-lesson-title"
          className="mt-1.5 flex items-baseline gap-2 text-lg font-bold leading-tight text-white md:text-xl"
        >
          <span aria-hidden className="text-base md:text-lg">
            {lesson.subjectEmoji ?? "🎓"}
          </span>
          <span className="min-w-0">
            🔴 ПРЯМО СЕЙЧАС ИДЁТ УРОК: <span className="text-emerald-200">{lesson.subjectName}</span>
          </span>
        </h2>

        {details ? <p className="mt-1 truncate text-xs text-emerald-100/80">{details}</p> : null}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <Link
            href={`/meeting?room=${encodeURIComponent(lesson.meetingCode)}`}
            prefetch={false}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-emerald-950 shadow-[0_8px_30px_rgba(16,185,129,0.35)] transition hover:bg-emerald-300 active:scale-[0.99] md:text-base"
          >
            <Video className="h-5 w-5" />
            ВОЙТИ В УРОК ПРЯМО СЕЙЧАС
            <ArrowRight className="h-5 w-5" />
          </Link>

          {canEnd ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={ending}
              aria-label="Завершить урок"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-rose-400/40 bg-rose-600 px-4 py-3.5 text-sm font-bold text-white shadow-[0_8px_24px_rgba(225,29,72,0.35)] transition hover:bg-rose-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-500/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 md:text-base"
            >
              {ending ? <Loader2 className="h-5 w-5 animate-spin" /> : <PhoneOff className="h-5 w-5" />}
              <span>{ending ? "Завершаем…" : "🔴 Завершить урок"}</span>
            </button>
          ) : null}
        </div>
      </section>

      <Modal
        open={confirmOpen}
        onClose={() => {
          if (!ending) setConfirmOpen(false);
        }}
        disableClose={ending}
        labelledBy={titleId}
        describedBy={descriptionId}
        portal
        className="sm:max-w-md"
      >
        <div className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-300">
              <PhoneOff className="h-5 w-5" />
            </span>
            <h2 id={titleId} className="text-lg font-semibold text-white">
              Завершить этот урок для всех участников?
            </h2>
          </div>

          <p id={descriptionId} className="text-sm leading-relaxed text-slate-300">
            Урок «{lesson.subjectName}» будет завершён, комната закрыта для всех подключённых
            участников, а плашка активного урока сразу исчезнет с главного экрана.
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={ending}
              className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmEnd()}
              disabled={ending}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
            >
              {ending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {ending ? "Завершаем…" : "Завершить урок"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
