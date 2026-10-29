import type { AnnouncementDto } from "@/lib/announcements";
import type { ReviewQueue, UrgentHomeworkItem } from "@/lib/homework";
import type { LiveLesson } from "@/lib/live-lesson-rules";
import type { SchoolViewer } from "@/lib/school-viewer";
import type { Role, Schedule } from "@/types";

/**
 * «Неубиваемый» дашборд: формы данных и страховки на случай задержки БД.
 *
 * `/dashboard` — серверный (RSC) компонент: любое необработанное исключение из
 * запроса к Neon превращается в экран ошибки Next.js вместо кабинета. Поэтому
 * страница обязана рендериться даже тогда, когда база не ответила:
 *  - каждая секция данных грузится в собственном `try/catch` и имеет fallback;
 *  - у каждой секции есть дедлайн (`withDeadline`), чтобы «висящий» запрос не
 *    держал рендер бесконечно;
 *  - модуль намеренно не импортирует Prisma — только типы, — поэтому его можно
 *    тестировать без базы (`scripts/rules.test.ts`).
 */

/** Сколько ждём секцию данных, прежде чем отдать fallback (мс). */
export const DASHBOARD_SECTION_TIMEOUT_MS = 12000;

/** Итоговый объект данных страницы: всё, что рисует кабинет. */
export interface DashboardData {
  /** Расписание (уроки) в том виде, в каком их видит роль. */
  lessons: Schedule[];
  /** Виджет «Срочные ДЗ». */
  urgent: UrgentHomeworkItem[];
  /** Виджет «Нужно проверить». */
  review: ReviewQueue;
  /** Баннер объявлений школы. */
  announcements: AnnouncementDto[];
  /**
   * Урок, который идёт прямо сейчас (слот расписания или открытая комната
   * школы). `null` — живого урока нет, крупная карточка входа не рисуется.
   */
  liveLesson: LiveLesson | null;
  /** Зритель из БД; null, если БД не ответила (тогда работает `viewerFromClaims`). */
  viewer: SchoolViewer | null;
  /**
   * `true` — часть данных не пришла (таймаут/ошибка БД) и показан fallback.
   * Страница рендерится, но честно сообщает, что данные неполные.
   */
  degraded: boolean;
}

/** Пустая (но валидная для рендера) заготовка данных дашборда. */
export function emptyDashboardData(): DashboardData {
  return {
    lessons: [],
    urgent: [],
    review: { count: 0, items: [] },
    announcements: [],
    liveLesson: null,
    viewer: null,
    degraded: true,
  };
}

/** Валидный fallback-объект: страница рендерится всегда, даже без БД. */
export function buildDashboardFallback(overrides: Partial<DashboardData> = {}): DashboardData {
  return { ...emptyDashboardData(), ...overrides };
}

/**
 * Зритель из JWT-сессии.
 *
 * `schoolId`/`classId`/`role` уже лежат в токене, поэтому кабинет может показать
 * расписание и виджеты даже тогда, когда `getSchoolViewer()` не достучался до
 * базы (задержка Neon, P2028). Данные из токена подписаны, подделывать их
 * клиент не может; при первой же удачной загрузке значения уточняются из БД.
 */
export function viewerFromClaims(claims: {
  id: string;
  role: Role;
  schoolId?: string | null;
  classId?: string | null;
  isBanned?: boolean;
}): SchoolViewer {
  return {
    id: claims.id,
    role: claims.role,
    schoolId: claims.schoolId ?? null,
    classId: claims.classId ?? null,
    className: null,
    grade: null,
    isBanned: claims.isBanned === true,
  };
}

/**
 * Ограничивает ожидание промиса дедлайном: успел — отдаём результат, не успел —
 * `null` и предупреждаем в лог.
 *
 * Отменять запрос к Prisma нельзя, поэтому «брошенный» промис мы догашиваем в
 * фоне и глушим его ошибку (`task.catch`), иначе Node ругнётся на unhandled
 * rejection уже после того, как страница отрисовалась.
 */
export async function withDeadline<T>(
  task: Promise<T>,
  label: string,
  timeoutMs: number = DASHBOARD_SECTION_TIMEOUT_MS,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      task,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[DASHBOARD_TIMEOUT] секция «${label}» не ответила за ${timeoutMs} мс`);
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    task.catch(() => undefined);
  }
}
