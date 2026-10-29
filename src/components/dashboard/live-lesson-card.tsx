import Link from "next/link";
import { ArrowRight, Radio, Video } from "lucide-react";

import type { LiveLesson } from "@/lib/live-lesson-rules";

/**
 * Крупная карточка «🔴 ПРЯМО СЕЙЧАС ИДЁТ УРОК» — самый верх кабинета.
 *
 * Зачем: на открытый урок ученик должен попадать в один клик, без пароля,
 * кода комнаты и ссылки. Кнопка ведёт на `/meeting?room=<код>`, а страница
 * `/meeting` сразу редиректит в видеокомнату `/meeting/<код>` (доступ всё
 * равно проверяется сервером по сессии и школе — открытого доступа нет).
 *
 * Пульсирующая красная точка — два слоя: статичный `bg-rose-500` и
 * `animate-ping` поверх него: видно «прямой эфир», не отвлекая анимацией
 * от заголовка.
 */
export function LiveLessonCard({ lesson }: { lesson: LiveLesson }) {
  const timeLabel =
    lesson.startTime && lesson.endTime ? `${lesson.startTime}–${lesson.endTime}` : null;
  const details = [lesson.teacherName, timeLabel].filter(Boolean).join(" · ");

  return (
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

      <Link
        href={`/meeting?room=${encodeURIComponent(lesson.meetingCode)}`}
        prefetch={false}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-emerald-950 shadow-[0_8px_30px_rgba(16,185,129,0.35)] transition hover:bg-emerald-300 active:scale-[0.99] md:text-base"
      >
        <Video className="h-5 w-5" />
        ВОЙТИ В УРОК ПРЯМО СЕЙЧАС
        <ArrowRight className="h-5 w-5" />
      </Link>
    </section>
  );
}
