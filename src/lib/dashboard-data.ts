import { listActiveAnnouncementsForViewer } from "@/lib/announcements";
import {
  DASHBOARD_SECTION_TIMEOUT_MS,
  buildDashboardFallback,
  viewerFromClaims,
  withDeadline,
  type DashboardData,
} from "@/lib/dashboard-fallback";
import { getReviewQueue, getUrgentHomework } from "@/lib/homework";
import { findLiveLessonForViewer } from "@/lib/live-lesson";
import type { LiveLesson } from "@/lib/live-lesson-rules";
import { listLessonsForViewer } from "@/lib/schedule";
import { findLiveLesson, findNextLesson, getSchoolClock, type NextLesson, type SchoolClock } from "@/lib/schedule-rules";
import { getSchoolViewer, type SchoolViewer } from "@/lib/school-viewer";
import type { Role, Schedule } from "@/types";

/**
 * Загрузка данных кабинета: каждая секция изолирована.
 *
 * Правило страницы `/dashboard`: **ни одна** ветка загрузки не выбрасывает
 * исключение наружу. Задержка Neon, P2028 в фоновой досыпке тенанта
 * (`homework.updateMany`), обрыв соединения — всё это логируется и превращается
 * в валидные пустые данные, поэтому RSC-рендер не падает.
 *
 * Секции:
 *  1. зритель (`getSchoolViewer`) — самый «дорогой» вызов: внутри досыпка
 *     школ/классов и `homework.updateMany`; при сбое берём роль/школу из токена;
 *  2. расписание — виджет «следующий урок»;
 *  3. виджеты ДЗ — «срочные ДЗ» и «нужно проверить»;
 *  4. объявления школы.
 */

export interface LoadDashboardInput {
  /** id пользователя из подписанного JWT. */
  userId: string;
  role: Role;
  /** Претензии сессии — резервный источник тенанта, когда БД не ответила. */
  schoolId?: string | null;
  classId?: string | null;
  /** Момент рендера; передаём снаружи, чтобы все секции считали одинаково. */
  now: Date;
  /** Дедлайн на секцию, мс (в тестах/медленных окружениях можно уменьшить). */
  timeoutMs?: number;
}

export async function loadDashboardData(input: LoadDashboardInput): Promise<DashboardData> {
  const { userId, role, schoolId, classId, now } = input;
  const timeoutMs = input.timeoutMs ?? DASHBOARD_SECTION_TIMEOUT_MS;
  const claimsViewer = viewerFromClaims({ id: userId, role, schoolId, classId });

  let degraded = false;

  /* 1. Зритель из БД. Сбой здесь — не повод терять кабинет: роль и тенант есть в токене. */
  let viewer: SchoolViewer | null = null;
  try {
    viewer = await withDeadline(getSchoolViewer(userId), "getSchoolViewer", timeoutMs);
    if (viewer === null) degraded = true;
  } catch (error) {
    console.error("[DASHBOARD_VIEWER_WARN]", error);
    degraded = true;
  }
  const activeViewer = viewer ?? claimsViewer;

  /* 2. Расписание. */
  let lessons: Schedule[] = [];
  try {
    const loaded = await withDeadline(listLessonsForViewer(activeViewer), "listLessonsForViewer", timeoutMs);
    if (loaded === null) degraded = true;
    else lessons = loaded;
  } catch (error) {
    console.error("[DASHBOARD_SCHEDULE_WARN]", error);
    degraded = true;
  }

  /* 3. Виджеты ДЗ: срочные задания и очередь проверки — каждая ветка со своим fallback. */
  const [urgent, review] = await Promise.all([
    loadUrgentHomework(activeViewer, now, timeoutMs),
    loadReviewQueue(activeViewer, timeoutMs),
  ]);
  if (urgent.degraded || review.degraded) degraded = true;

  /* 4. Объявления: уже были изолированы, вынесли сюда же для единого контракта. */
  let announcements: DashboardData["announcements"] = [];
  try {
    const loaded = await withDeadline(
      listActiveAnnouncementsForViewer({
        id: userId,
        role,
        schoolId: activeViewer.schoolId,
        grade: activeViewer.grade,
      }),
      "listActiveAnnouncementsForViewer",
      timeoutMs,
    );
    if (loaded === null) degraded = true;
    else announcements = loaded;
  } catch (error) {
    console.error("[DASHBOARD_ANNOUNCEMENTS_WARN]", error);
    degraded = true;
  }

  /*
    5. Урок «прямо сейчас»: карточка входа в 1 клик.
    Источник — уже загруженное расписание зрителя и открытые комнаты школы;
    сбой здесь не должен ломать кабинет, поэтому секция изолирована.
  */
  let liveLesson: LiveLesson | null = null;
  try {
    liveLesson = await withDeadline(
      findLiveLessonForViewer(activeViewer, lessons, now),
      "findLiveLessonForViewer",
      timeoutMs,
    );
  } catch (error) {
    console.error("[DASHBOARD_LIVE_LESSON_WARN]", error);
  }

  return buildDashboardFallback({
    lessons,
    urgent: urgent.items,
    review: review.queue,
    announcements,
    liveLesson,
    viewer,
    degraded,
  });
}

async function loadUrgentHomework(
  viewer: SchoolViewer,
  now: Date,
  timeoutMs: number,
): Promise<{ items: DashboardData["urgent"]; degraded: boolean }> {
  try {
    const items = await withDeadline(getUrgentHomework(viewer, now), "getUrgentHomework", timeoutMs);
    return items === null ? { items: [], degraded: true } : { items, degraded: false };
  } catch (error) {
    console.error("[DASHBOARD_HW_UPDATE_WARN]", error);
    return { items: [], degraded: true };
  }
}

async function loadReviewQueue(
  viewer: SchoolViewer,
  timeoutMs: number,
): Promise<{ queue: DashboardData["review"]; degraded: boolean }> {
  try {
    const queue = await withDeadline(getReviewQueue(viewer), "getReviewQueue", timeoutMs);
    return queue === null ? { queue: { count: 0, items: [] }, degraded: true } : { queue, degraded: false };
  } catch (error) {
    console.error("[DASHBOARD_HW_UPDATE_WARN]", error);
    return { queue: { count: 0, items: [] }, degraded: true };
  }
}

/** Живой/следующий урок считаем из уже загруженного списка — это чистые функции. */
export interface LessonSnapshot {
  clock: SchoolClock;
  live: Schedule | null;
  next: NextLesson<Schedule> | null;
}

export function resolveLessonSnapshot(lessons: Schedule[], now: Date): LessonSnapshot {
  const fallbackClock: SchoolClock = { dayOfWeek: 1, minutes: 0 };
  let clock = fallbackClock;
  try {
    clock = getSchoolClock(now);
  } catch (error) {
    console.error("[DASHBOARD_CLOCK_WARN]", error);
  }

  try {
    return { clock, live: findLiveLesson(lessons, clock), next: findNextLesson(lessons, clock) };
  } catch (error) {
    console.error("[DASHBOARD_CLOCK_WARN]", error);
    return { clock, live: null, next: null };
  }
}
