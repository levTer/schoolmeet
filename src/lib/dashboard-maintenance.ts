import { withDeadline } from "@/lib/dashboard-fallback";
import { INTERACTIVE_TRANSACTION_OPTIONS, prisma } from "@/lib/prisma";
import type { SchoolViewer } from "@/lib/school-viewer";

/**
 * Фоновая досыпка кабинета: обновление просроченных статусов ДЗ и перерасчёт
 * метрик школы.
 *
 * Это best-effort операции «на полях» рендера `/dashboard`. Их сбой (таймаут
 * Neon, P2028 у фоновой транзакции, обрыв соединения) **никогда** не должен
 * превращаться в экран ошибки RSC, поэтому:
 *  - вызывающая страница оборачивает каждую операцию в свой `try/catch` с
 *    логом `[DASHBOARD_HW_UPDATE_WARN]`;
 *  - каждая функция дополнительно ограничена дедлайном (`withDeadline`), чтобы
 *    медленная база не держала рендер;
 *  - все записи идемпотентны и ограничены пачкой (`MAINTENANCE_BATCH`).
 */

/** Сколько записей ремонтируем за один заход — фоновая досыпка не должна блокировать рендер. */
const MAINTENANCE_BATCH = 50;

/** Дедлайн фоновой операции, мс: дольше задерживать рендер кабинета нельзя. */
const MAINTENANCE_TIMEOUT_MS = 3000;

/** Не чаще одного прохода на школу в минуту: `/dashboard` — «горячая» страница. */
const OVERDUE_SYNC_INTERVAL_MS = 60_000;

/** Метрики школы кэшируем на полминуты, чтобы не считать одно и то же на каждом рендере. */
const METRICS_TTL_MS = 30_000;

/** Страховка от роста карт в долгоживущем процессе. */
const MAINTENANCE_CACHE_LIMIT = 500;

const lastOverdueSyncAt = new Map<string, number>();

interface CachedMetrics {
  expiresAt: number;
  value: DashboardMetrics;
}

const metricsCache = new Map<string, CachedMetrics>();

/* -------------------------------------------------------------------------- */
/* 1. Просроченные статусы ДЗ                                                  */
/* -------------------------------------------------------------------------- */

export interface OverdueSyncResult {
  /** Сколько записей приведено в согласованное состояние. */
  repaired: number;
  /** Проход пропущен: нет школы, не прошёл интервал или сработал дедлайн. */
  skipped: boolean;
  checkedAt: string;
}

/**
 * Обновляет «просроченные» статусы ДЗ школы, приводя их к состоянию, которое
 * ожидает UI:
 *
 *  1. работа сдана (`SUBMITTED`), но время сдачи в БД пустое — очередь проверки
 *     показывала бы её как «сдана только что» (`submittedAt ?? new Date()`);
 *  2. просроченный черновик с непустым ответом без отметки автосохранения —
 *     карточка задания не может показать «черновик сохранён».
 *
 * Операция идемпотентна (фильтры `null`/`not: ""` не дадут переписать свежие
 * значения), ограничена пачкой и одной школой, а также троттлится по времени.
 */
export async function syncOverdueHomeworkStatuses(
  viewer: SchoolViewer,
  now: Date,
): Promise<OverdueSyncResult> {
  const schoolId = viewer.schoolId;
  if (!schoolId) return { repaired: 0, skipped: true, checkedAt: now.toISOString() };

  const lastRun = lastOverdueSyncAt.get(schoolId) ?? 0;
  if (now.getTime() - lastRun < OVERDUE_SYNC_INTERVAL_MS) {
    return { repaired: 0, skipped: true, checkedAt: new Date(lastRun).toISOString() };
  }

  /* Отметку времени ставим ДО запроса: параллельные рендеры кабинета не должны
     дублировать фоновую работу. Сбой тоже оставляет отметку — так мы защищаем
     медленную базу от «шторма» повторных попыток на каждом рендере. */
  rememberSync(schoolId, now.getTime());

  const result = await withDeadline(
    repairOverdueHomeworkStatuses(schoolId, now),
    "syncOverdueHomeworkStatuses",
    MAINTENANCE_TIMEOUT_MS,
  );

  if (!result) return { repaired: 0, skipped: true, checkedAt: now.toISOString() };
  return { repaired: result, skipped: false, checkedAt: now.toISOString() };
}

function rememberSync(schoolId: string, timestamp: number): void {
  if (lastOverdueSyncAt.size > MAINTENANCE_CACHE_LIMIT) lastOverdueSyncAt.clear();
  lastOverdueSyncAt.set(schoolId, timestamp);
}

async function repairOverdueHomeworkStatuses(schoolId: string, now: Date): Promise<number> {
  let repaired = 0;

  /* 1. Сдачи без времени сдачи. */
  const staleSubmissions = await prisma.homeworkSubmission.findMany({
    where: { status: "SUBMITTED", submittedAt: null, homework: { schoolId } },
    select: { id: true },
    take: MAINTENANCE_BATCH,
  });
  if (staleSubmissions.length > 0) {
    const { count } = await prisma.homeworkSubmission.updateMany({
      where: { id: { in: staleSubmissions.map((row) => row.id) }, status: "SUBMITTED", submittedAt: null },
      data: { submittedAt: now },
    });
    repaired += count;
  }

  /* 2. Просроченные черновики с ответом, но без отметки автосохранения. */
  const overdueDrafts = await prisma.homeworkSubmission.findMany({
    where: {
      status: "DRAFT",
      answer: { not: "" },
      draftSavedAt: null,
      homework: { schoolId, deadline: { lt: now } },
    },
    select: { id: true },
    take: MAINTENANCE_BATCH,
  });
  if (overdueDrafts.length > 0) {
    const { count } = await prisma.homeworkSubmission.updateMany({
      where: { id: { in: overdueDrafts.map((row) => row.id) }, status: "DRAFT", draftSavedAt: null },
      data: { draftSavedAt: now },
    });
    repaired += count;
  }

  return repaired;
}

/* -------------------------------------------------------------------------- */
/* 2. Метрики школы                                                            */
/* -------------------------------------------------------------------------- */

/** Сводка по ДЗ в объёме роли: используется как запасной счётчик виджетов. */
export interface DashboardMetrics {
  /** Просроченные задания (дедлайн прошёл). */
  overdueHomework: number;
  /** Черновики с ответом — работа начата, но не сдана. */
  draftsWithContent: number;
  /** Работы на проверке (для ученика — его собственные). */
  pendingReviews: number;
  computedAt: string;
}

/**
 * Перерасчёт метрик школы/учителя/ученика одним батчем в интерактивной
 * транзакции с увеличенными тайм-аутами (Neon отвечает с задержкой).
 *
 * Возвращает снимок метрик либо `null`, если БД не успела/не ответила:
 * вызывающая сторона в этом случае просто оставляет пустые виджеты.
 * Результат кэшируется на `METRICS_TTL_MS` — считаем метрики не на каждом
 * рендере кабинета, а раз в полминуты на область видимости.
 */
export async function recalculateDashboardMetrics(
  viewer: SchoolViewer,
  now: Date,
): Promise<DashboardMetrics | null> {
  if (!viewer.schoolId) return null;

  const key = metricsCacheKey(viewer);
  const cached = metricsCache.get(key);
  if (cached && cached.expiresAt > now.getTime()) return cached.value;

  const computed = await withDeadline(
    computeMetrics(viewer, now),
    "recalculateDashboardMetrics",
    MAINTENANCE_TIMEOUT_MS,
  );

  if (!computed) return cached?.value ?? null;

  if (metricsCache.size > MAINTENANCE_CACHE_LIMIT) metricsCache.clear();
  metricsCache.set(key, { expiresAt: now.getTime() + METRICS_TTL_MS, value: computed });
  return computed;
}

function metricsCacheKey(viewer: SchoolViewer): string {
  if (viewer.role === "ADMIN") return `school:${viewer.schoolId}`;
  if (viewer.role === "TEACHER") return `teacher:${viewer.id}`;
  return `student:${viewer.id}`;
}

async function computeMetrics(viewer: SchoolViewer, now: Date): Promise<DashboardMetrics> {
  const schoolId = viewer.schoolId!;
  const computedAt = now.toISOString();

  return prisma.$transaction(
    async (tx) => {
      if (viewer.role === "STUDENT") {
        const homeworkScope = {
          schoolId,
          ...(viewer.classId ? { classId: viewer.classId } : {}),
          deadline: { lt: now },
        };
        const overdueHomework = await tx.homework.count({ where: homeworkScope });
        const draftsWithContent = await tx.homeworkSubmission.count({
          where: { studentId: viewer.id, status: "DRAFT", answer: { not: "" } },
        });
        const pendingReviews = await tx.homeworkSubmission.count({
          where: { studentId: viewer.id, status: "SUBMITTED" },
        });
        return { overdueHomework, draftsWithContent, pendingReviews, computedAt };
      }

      const homeworkScope = viewer.role === "ADMIN" ? { schoolId } : { schoolId, teacherId: viewer.id };
      const submissionScope = {
        homework: viewer.role === "ADMIN" ? { schoolId } : { schoolId, teacherId: viewer.id },
      };

      const overdueHomework = await tx.homework.count({ where: { ...homeworkScope, deadline: { lt: now } } });
      const draftsWithContent = await tx.homeworkSubmission.count({
        where: { ...submissionScope, status: "DRAFT", answer: { not: "" } },
      });
      const pendingReviews = await tx.homeworkSubmission.count({
        where: { ...submissionScope, status: "SUBMITTED" },
      });

      return { overdueHomework, draftsWithContent, pendingReviews, computedAt };
    },
    INTERACTIVE_TRANSACTION_OPTIONS,
  );
}
