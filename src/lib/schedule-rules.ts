/**
 * Правила расписания (чистый TypeScript, без Prisma и DOM).
 *
 * Модуль используется и API-роутами, и клиентскими компонентами, поэтому
 * здесь нет серверных зависимостей. Всё «сейчас» считается во времени школы
 * (`NEXT_PUBLIC_SCHOOL_TIMEZONE`), чтобы сервер и браузер сходились в одном
 * и том же статусе урока независимо от часового пояса компьютера.
 */

import type { DayOfWeek } from "@/types";

/* -------------------------------------------------------------------------- */
/* Классы и константы                                                          */
/* -------------------------------------------------------------------------- */

export const GRADES = [
  "GRADE_5",
  "GRADE_6",
  "GRADE_7",
  "GRADE_8",
  "GRADE_9",
  "GRADE_10",
  "GRADE_11",
] as const;

export type GradeCode = (typeof GRADES)[number];

export const GRADE_LABELS: Record<GradeCode, string> = {
  GRADE_5: "5 класс",
  GRADE_6: "6 класс",
  GRADE_7: "7 класс",
  GRADE_8: "8 класс",
  GRADE_9: "9 класс",
  GRADE_10: "10 класс",
  GRADE_11: "11 класс",
};

export function isGradeCode(value: unknown): value is GradeCode {
  return typeof value === "string" && (GRADES as readonly string[]).includes(value);
}

/** Часовой пояс школы. Значение по умолчанию — Москва. */
export const SCHOOL_TIMEZONE: string = process.env.NEXT_PUBLIC_SCHOOL_TIMEZONE || "Europe/Moscow";

/** Границы учебного дня в минутах от полуночи: 07:00 – 21:00. */
export const SCHOOL_DAY_START = 7 * 60;
export const SCHOOL_DAY_END = 21 * 60;

/** Минимальная и максимальная длительность урока, минут. */
export const LESSON_MIN_DURATION = 15;
export const LESSON_MAX_DURATION = 180;

/** За сколько минут до начала урок получает статус «Скоро». */
export const SOON_WINDOW_MINUTES = 15;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/* -------------------------------------------------------------------------- */
/* Время                                                                       */
/* -------------------------------------------------------------------------- */

/** «09:45» → 585. Возвращает `null`, если строка не соответствует HH:mm. */
export function parseTime(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 585 → «09:45». */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export interface TimeSlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/** Два слота пересекаются, если они в один день и их интервалы имеют общую часть. */
export function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false;
  const aStart = parseTime(a.startTime);
  const aEnd = parseTime(a.endTime);
  const bStart = parseTime(b.startTime);
  const bEnd = parseTime(b.endTime);
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return false;
  return aStart < bEnd && bStart < aEnd;
}

/** Текст ошибки для пары времён или `null`, если всё в порядке. */
export function validateLessonTimes(startTime: string, endTime: string): string | null {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  if (start === null || end === null) return "Время укажите в формате ЧЧ:ММ";
  if (end <= start) return "Урок должен заканчиваться позже, чем начинается";

  const duration = end - start;
  if (duration < LESSON_MIN_DURATION) return `Урок должен длиться не меньше ${LESSON_MIN_DURATION} минут`;
  if (duration > LESSON_MAX_DURATION) return `Урок не может длиться больше ${LESSON_MAX_DURATION} минут`;

  if (start < SCHOOL_DAY_START || end > SCHOOL_DAY_END) {
    return `Уроки проводятся с ${formatMinutes(SCHOOL_DAY_START)} до ${formatMinutes(SCHOOL_DAY_END)}`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Часы школы и статусы уроков                                                 */
/* -------------------------------------------------------------------------- */

export interface SchoolClock {
  /** ISO-день недели: 1 — понедельник … 7 — воскресенье. */
  dayOfWeek: DayOfWeek;
  /** Минуты от полуночи во времени школы. */
  minutes: number;
}

const WEEKDAY_TO_ISO: Record<string, DayOfWeek> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Текущий день недели и время в часовом поясе школы. */
export function getSchoolClock(date: Date, timeZone: string = SCHOOL_TIMEZONE): SchoolClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";

  const dayOfWeek = WEEKDAY_TO_ISO[get("weekday")] ?? 1;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return { dayOfWeek, minutes: minutes % (24 * 60) };
}

export type LessonStatus = "soon" | "live" | "finished";

/**
 * Статус урока относительно текущего времени.
 *  - `live`     — идёт сейчас (пульсирующая метка);
 *  - `soon`     — начнётся в ближайшие SOON_WINDOW_MINUTES минут;
 *  - `finished` — уже прошёл (сегодня после окончания или в прошедшие дни недели);
 *  - `null`     — урок в будущем, статус не показываем.
 */
export function getLessonStatus(lesson: TimeSlot, clock: SchoolClock): LessonStatus | null {
  const start = parseTime(lesson.startTime);
  const end = parseTime(lesson.endTime);
  if (start === null || end === null) return null;

  if (lesson.dayOfWeek < clock.dayOfWeek) return "finished";
  if (lesson.dayOfWeek > clock.dayOfWeek) return null;

  if (clock.minutes >= end) return "finished";
  if (clock.minutes >= start) return "live";
  if (start - clock.minutes <= SOON_WINDOW_MINUTES) return "soon";
  return null;
}

export interface NextLesson<T extends TimeSlot> {
  lesson: T;
  /** Сколько минут до начала (учитывает переход на следующий день). */
  minutesUntil: number;
}

/**
 * Ближайший урок, который ещё не начался. Если сегодня уроков больше нет,
 * ищем в ближайшие дни недели, а при необходимости — на следующей неделе.
 */
export function findNextLesson<T extends TimeSlot>(lessons: readonly T[], clock: SchoolClock): NextLesson<T> | null {
  let best: NextLesson<T> | null = null;

  for (const lesson of lessons) {
    const start = parseTime(lesson.startTime);
    if (start === null) continue;

    let dayDiff = (lesson.dayOfWeek - clock.dayOfWeek + 7) % 7;
    // Урок того же дня, который уже начался, относится к следующей неделе.
    if (dayDiff === 0 && start <= clock.minutes) dayDiff = 7;

    const minutesUntil = dayDiff * 24 * 60 + start - clock.minutes;
    if (!best || minutesUntil < best.minutesUntil) {
      best = { lesson, minutesUntil };
    }
  }

  return best;
}

/** Урок, который идёт прямо сейчас (если есть). */
export function findLiveLesson<T extends TimeSlot>(lessons: readonly T[], clock: SchoolClock): T | null {
  return (
    lessons.find((lesson) => getLessonStatus(lesson, clock) === "live") ?? null
  );
}

/* -------------------------------------------------------------------------- */
/* Валидация запроса на создание урока                                         */
/* -------------------------------------------------------------------------- */

/** Конфликт расписания, который возвращает API при создании урока (HTTP 409). */
export interface ScheduleConflictInfo {
  kind: "grade" | "teacher" | "room";
  lessonId: string;
  subjectName: string;
  grade: GradeCode;
  startTime: string;
  endTime: string;
  teacherName: string;
}

export interface CreateLessonInput {
  subjectId: string;
  classId: string;
  grade: GradeCode;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  room: string | null;
}

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fields?: Record<string, string> };

const ROOM_MAX_LENGTH = 40;

/** Проверка тела POST /api/schedule. Существование предмета проверяет сервер. */
export function validateCreateLesson(payload: unknown): ValidationResult<CreateLessonInput> {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const subjectId = typeof raw.subjectId === "string" ? raw.subjectId.trim() : "";
  if (!subjectId) fields.subjectId = "Выберите предмет";

  const classId = typeof raw.classId === "string" ? raw.classId.trim() : "";
  if (!classId) fields.classId = "Выберите класс";

  const grade = isGradeCode(raw.grade) ? raw.grade : null;
  if (!grade) fields.grade = "Выберите класс";

  const dayNumber = typeof raw.dayOfWeek === "number" ? raw.dayOfWeek : Number(raw.dayOfWeek);
  const dayOfWeek = Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= 7 ? (dayNumber as DayOfWeek) : null;
  if (!dayOfWeek) fields.dayOfWeek = "Выберите день недели";

  const startTime = typeof raw.startTime === "string" ? raw.startTime.trim() : "";
  const endTime = typeof raw.endTime === "string" ? raw.endTime.trim() : "";
  const timeError = validateLessonTimes(startTime, endTime);
  if (timeError) fields.time = timeError;

  const roomRaw = typeof raw.room === "string" ? raw.room.trim() : "";
  if (roomRaw.length > ROOM_MAX_LENGTH) fields.room = `Не длиннее ${ROOM_MAX_LENGTH} символов`;

  if (Object.keys(fields).length > 0 || !classId || !grade || !dayOfWeek) {
    return { ok: false, error: "Проверьте правильность заполнения полей", fields };
  }

  return {
    ok: true,
    data: {
      subjectId,
      classId,
      grade,
      dayOfWeek,
      startTime,
      endTime,
      room: roomRaw || null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Локальное время школы ↔ Date                                                */
/* -------------------------------------------------------------------------- */

/** Смещение часового пояса от UTC в миллисекундах для момента `date`. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/** «2026-10-13T18:00» (время школы) → Date в UTC. Возвращает `null` для некорректной строки. */
export function schoolLocalToDate(local: string, timeZone: string = SCHOOL_TIMEZONE): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;

  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const result = new Date(guess - timeZoneOffsetMs(new Date(guess), timeZone));
  return Number.isNaN(result.getTime()) ? null : result;
}

/** Date → «2026-10-13T18:00» во времени школы (значение для `datetime-local`). */
export function formatSchoolLocalInput(date: Date, timeZone: string = SCHOOL_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
