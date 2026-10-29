import { prisma } from "@/lib/prisma";
import { schoolScope } from "@/lib/admin-tenant";
import { listAuditLogs, type AuditLogEntry } from "@/lib/audit";
import { liveRoomsSummary } from "@/lib/realtime-control";
import { GRADES, GRADE_LABELS, type GradeCode } from "@/lib/schedule-rules";

/**
 * Метрики и графики админ-панели (`/admin`).
 *
 * Все выборки ограничены по объёму и кэшируются на короткое время: страница
 * обзора обновляется автоматически, а БД не должна страдать от поллинга.
 */

/** Срок жизни кэша обзора: страница может обновляться, БД — нет. */
const CACHE_TTL_MS = 15_000;

/** Сколько дней берём для графика активности звонков. */
const ACTIVITY_WINDOW_DAYS = 28;

/** Верхняя граница выборок, чтобы тяжёлый запрос не «съел» память. */
const MAX_ROWS = 4000;

const WEEKDAY_LABELS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export interface MetricCard {
  key: string;
  label: string;
  value: number;
  hint: string;
}

export interface ChartPoint {
  label: string;
  short: string;
  value: number;
}

export interface AdminOverview {
  metrics: MetricCard[];
  /** Активность звонков по дням недели (входы в уроки за 28 дней). */
  callActivity: ChartPoint[];
  /** Средняя успеваемость по классам 5–11. */
  grades: ChartPoint[];
  /** Последние действия администрации. */
  recentAudit: AuditLogEntry[];
  totals: {
    users: number;
    students: number;
    teachers: number;
    admins: number;
    banned: number;
    liveRooms: number;
    liveParticipants: number;
  };
  generatedAt: string;
}

interface Cache {
  value: AdminOverview;
  expiresAt: number;
}

const cache = new Map<string, Cache>();

/** Начало текущих суток (локальное время школы у пользователя). */
function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Индекс дня недели в порядке Пн…Вс (Date#getDay: 0 — воскресенье). */
function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * Собирает полный обзор для страницы `/admin`.
 * `now` вынесен параметром — так метрики легко тестировать.
 */
export async function getAdminOverview(schoolId: string, now: Date = new Date(), options: { noCache?: boolean } = {}): Promise<AdminOverview> {
  const tenant = schoolScope(schoolId);
  const cached = cache.get(schoolId);
  if (!options.noCache && cached && cached.expiresAt > now.getTime()) {
    return cached.value;
  }

  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const activitySince = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [
    roleCounts,
    banned,
    submittedThisWeek,
    attendance,
    reviews,
    recentAudit,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], where: tenant, _count: { _all: true } }),
    prisma.user.count({ where: { isBanned: true, ...tenant } }),
    prisma.homeworkSubmission.count({ where: { submittedAt: { gte: weekAgo }, homework: { is: tenant } } }),
    prisma.attendanceRecord.findMany({
      where: { joinedAt: { gte: activitySince }, meeting: { is: tenant }, user: { is: tenant } },
      select: { joinedAt: true },
      orderBy: { joinedAt: "desc" },
      take: MAX_ROWS,
    }),
    prisma.homeworkReview.findMany({
      where: { grade: { not: null }, submission: { homework: { is: tenant } } },
      select: { grade: true, submission: { select: { homework: { select: { grade: true } } } } },
      orderBy: { approvedAt: "desc" },
      take: MAX_ROWS,
    }),
    listAuditLogs(schoolId, { take: 6 }),
  ]);

  const countByRole = new Map(roleCounts.map((row) => [row.role, row._count._all]));
  const students = countByRole.get("STUDENT") ?? 0;
  const teachers = countByRole.get("TEACHER") ?? 0;
  const admins = countByRole.get("ADMIN") ?? 0;
  const users = students + teachers + admins;

  /* График 1: активность звонков по дням недели ------------------------------ */
  const activityCounts = new Array(WEEKDAY_LABELS.length).fill(0) as number[];
  for (const record of attendance) {
    activityCounts[weekdayIndex(record.joinedAt)] += 1;
  }

  const callActivity: ChartPoint[] = WEEKDAY_LABELS.map((label, index) => ({
    label,
    short: WEEKDAY_SHORT[index],
    value: activityCounts[index],
  }));

  /* График 2: средняя успеваемость по классам 5–11 -------------------------- */
  const gradeStats = new Map<GradeCode, { sum: number; count: number }>();
  for (const review of reviews) {
    if (typeof review.grade !== "number") continue;
    const grade = review.submission.homework.grade as GradeCode | null;
    if (!grade) continue;

    const entry = gradeStats.get(grade) ?? { sum: 0, count: 0 };
    entry.sum += review.grade;
    entry.count += 1;
    gradeStats.set(grade, entry);
  }

  const grades: ChartPoint[] = GRADES.map((grade) => {
    const entry = gradeStats.get(grade);
    const average = entry && entry.count > 0 ? entry.sum / entry.count : 0;
    return {
      label: GRADE_LABELS[grade],
      short: GRADE_LABELS[grade].replace(/\D/g, ""),
      value: Math.round(average * 100) / 100,
    };
  });

  const live = liveRoomsSummary(schoolId);

  const metrics: MetricCard[] = [
    { key: "students", label: "Всего учеников", value: students, hint: "Аккаунты с ролью STUDENT" },
    { key: "teachers", label: "Учителей", value: teachers, hint: "Аккаунты с ролью TEACHER" },
    {
      key: "live",
      label: "Активных уроков сейчас",
      value: live.rooms,
      hint: live.participants > 0 ? `В комнатах ${live.participants} человек` : "Сейчас никто не учится",
    },
    { key: "homework", label: "Сданных ДЗ за неделю", value: submittedThisWeek, hint: "Отправлено за последние 7 дней" },
  ];

  const overview: AdminOverview = {
    metrics,
    callActivity,
    grades,
    recentAudit: recentAudit.items,
    totals: {
      users,
      students,
      teachers,
      admins,
      banned,
      liveRooms: live.rooms,
      liveParticipants: live.participants,
    },
    generatedAt: now.toISOString(),
  };

  cache.set(schoolId, { value: overview, expiresAt: now.getTime() + CACHE_TTL_MS });
  return overview;
}

/** Сбрасывает кэш обзора (после действий администратора). */
export function invalidateAdminOverview(schoolId?: string): void {
  if (schoolId) cache.delete(schoolId);
  else cache.clear();
}

/** Дополнительные метрики для блока «внутри»: очередь проверки и активные баны. */
export async function getAdminSecondaryMetrics(schoolId: string): Promise<{
  pendingReview: number;
  banned: number;
  todayJoins: number;
}> {
  const dayStart = startOfDay(new Date());
  const tenant = schoolScope(schoolId);

  const [pendingReview, banned, todayJoins] = await Promise.all([
    prisma.homeworkSubmission.count({ where: { status: "SUBMITTED", homework: { is: tenant } } }),
    prisma.user.count({ where: { isBanned: true, ...tenant } }),
    prisma.attendanceRecord.count({ where: { joinedAt: { gte: dayStart }, meeting: { is: tenant }, user: { is: tenant } } }),
  ]);

  return { pendingReview, banned, todayJoins };
}
