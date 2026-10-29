/**
 * «Прямо сейчас идёт урок» — чистые правила и типы карточки кабинета.
 *
 * Модуль намеренно не импортирует Prisma/DOM: карточку рисует кабинет,
 * а данные для неё собирают `@/lib/live-lesson` (сервер) и
 * `@/lib/dashboard-data`. Благодаря этому правила покрываются юнит-тестами
 * без базы и не тянут серверные зависимости в клиентский бандл.
 */

import type { Schedule } from "@/types";

/** Источник карточки: слот расписания или отдельно созданная комната урока. */
export type LiveLessonOrigin = "schedule" | "meeting";

/**
 * Данные крупной карточки «🔴 ПРЯМО СЕЙЧАС ИДЁТ УРОК».
 *
 * `meetingCode` — ключ входа в комнату: кнопка ведёт на
 * `/meeting?room=<meetingCode>` и открывает видеоурок без пароля и кода.
 * `meetingId` и `hostId` позволяют ведущему или администратору завершить
 * урок прямо с баннера кабинета.
 */
export interface LiveLesson {
  /** Идентификатор комнаты (`Meeting.id`), если известен. */
  meetingId: string | null;
  /** Код комнаты (`Meeting.meetingCode`) — то, что попадает в ссылку. */
  meetingCode: string;
  /** Организатор комнаты (`Meeting.hostId` / `Schedule.teacherId`). */
  hostId: string | null;
  /** Название урока для заголовка карточки. */
  title: string;
  /** Название предмета (для слота расписания — из каталога предметов). */
  subjectName: string;
  /** Эмодзи предмета, если известно. */
  subjectEmoji: string | null;
  /** Учитель, ведущий урок. `null` — данные не пришли. */
  teacherName: string | null;
  /** «HH:mm» начала (для слота расписания). */
  startTime: string | null;
  /** «HH:mm» окончания (для слота расписания). */
  endTime: string | null;
  origin: LiveLessonOrigin;
}

/** Слот расписания, который идёт прямо сейчас → карточка урока. */
export function liveLessonFromSchedule(
  lesson: Schedule,
  meeting?: { id?: string | null; hostId?: string | null } | null,
): LiveLesson {
  const subjectName = lesson.subject?.name ?? lesson.className ?? "Урок";

  return {
    meetingId: meeting?.id ?? null,
    meetingCode: lesson.meetingCode,
    hostId: meeting?.hostId ?? lesson.teacherId ?? null,
    title: subjectName,
    subjectName,
    subjectEmoji: lesson.subject?.emoji ?? null,
    teacherName: lesson.teacher?.name ?? null,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    origin: "schedule",
  };
}

/** Открытая комната школы (без слота расписания) → карточка урока. */
export function liveLessonFromMeeting(meeting: {
  id?: string | null;
  hostId?: string | null;
  title: string;
  meetingCode: string;
  host?: { id?: string | null; name: string | null } | null;
}): LiveLesson {
  return {
    meetingId: meeting.id ?? null,
    meetingCode: meeting.meetingCode,
    hostId: meeting.hostId ?? meeting.host?.id ?? null,
    title: meeting.title,
    subjectName: meeting.title,
    subjectEmoji: null,
    teacherName: meeting.host?.name ?? null,
    startTime: null,
    endTime: null,
    origin: "meeting",
  };
}
