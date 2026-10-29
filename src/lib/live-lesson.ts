/**
 * «Прямо сейчас идёт урок»: поиск живого урока школы для карточки кабинета.
 *
 * Два источника (по приоритету):
 *  1. слот расписания, который идёт прямо сейчас у зрителя (`findLiveLesson`
 *     по часам школы) — ученик видит урок своего класса, учитель — свой;
 *  2. открытая комната школы (`Meeting`): активный урок либо комната,
 *     созданная сегодня вне расписания — большой открытый урок, который
 *     учитель запустил вручную.
 *
 * Доступ к найденной комнате проверяется тем же правилом, что и при входе
 * (`checkMeetingAccess`): чужая школа или чужой класс в строгой школе карточку
 * не получают, поэтому кнопка «ВОЙТИ В УРОК» никогда не ведёт в отказ.
 */

import { checkMeetingAccess, listOpenSchoolMeetings } from "@/lib/meetings";
import { liveLessonFromMeeting, liveLessonFromSchedule, type LiveLesson } from "@/lib/live-lesson-rules";
import type { SchoolViewer } from "@/lib/school-viewer";
import {
  SCHOOL_TIMEZONE,
  findLiveLesson,
  formatSchoolLocalInput,
  getSchoolClock,
  schoolLocalToDate,
  type SchoolClock,
} from "@/lib/schedule-rules";
import type { Schedule } from "@/types";

/**
 * Начало текущих суток во времени школы.
 *
 * «Сегодняшний урок» считается по часовому поясу школы, а не по UTC сервера:
 * иначе в Москве открытый урок, созданный в 01:30, считался бы вчерашним.
 * При некорректном часовом поясе откатываемся на «сутки назад» — карточка
 * должна появляться, а не падать.
 */
export function schoolDayStart(now: Date, timeZone: string = SCHOOL_TIMEZONE): Date {
  const localMidnight = `${formatSchoolLocalInput(now, timeZone).slice(0, 10)}T00:00`;
  return schoolLocalToDate(localMidnight, timeZone) ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

/**
 * Живой урок школы или `null`.
 *
 * Исключения наружу не выбрасываются: кабинет обязан рендериться даже при
 * задержке БД — карточка просто не показывается.
 */
export async function findLiveLessonForViewer(
  viewer: SchoolViewer,
  lessons: readonly Schedule[],
  now: Date,
): Promise<LiveLesson | null> {
  if (!viewer.schoolId) return null;

  // 1. Урок расписания, который идёт прямо сейчас.
  try {
    const clock: SchoolClock = getSchoolClock(now);
    const live = findLiveLesson(lessons, clock);
    if (live) return liveLessonFromSchedule(live);
  } catch (error) {
    console.error("[LIVE_LESSON_CLOCK_WARN]", error);
  }

  // 2. Открытая комната школы (ручной «открытый урок» или активный статус).
  try {
    const meetings = await listOpenSchoolMeetings(viewer.schoolId, schoolDayStart(now));
    for (const meeting of meetings) {
      const decision = checkMeetingAccess(meeting, {
        id: viewer.id,
        role: viewer.role,
        schoolId: viewer.schoolId,
        classId: viewer.classId,
      });
      if (!decision.ok) continue;
      return liveLessonFromMeeting(meeting);
    }
  } catch (error) {
    console.error("[LIVE_LESSON_MEETING_WARN]", error);
  }

  return null;
}
