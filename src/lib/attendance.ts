import { prisma } from "@/lib/prisma";
import { schoolScope } from "@/lib/admin-tenant";
import type { GradeCode } from "@/lib/schedule-rules";
import type { Role } from "@/types";

/**
 * Посещаемость видеоуроков (модель `AttendanceRecord`).
 *
 * Одна запись = один вход участника в комнату: `joinedAt` пишется при
 * `join-room`, `leftAt` + `durationMinutes` — при выходе, разрыве соединения
 * или принудительном завершении урока администратором.
 *
 * Модуль используют и Socket.IO-сервер (`src/server/realtime.ts`), и API
 * админ-панели; поэтому работа с БД изолирована здесь.
 */

/** Повторный вход в течение этого времени считается тем же присутствием. */
const RESUME_WINDOW_MS = 5 * 60_000;

/** Через сколько часов незакрытую запись считаем «зависшей» (падение сервера). */
const STALE_AFTER_MS = 12 * 60 * 60_000;

/** Минуты между входом и выходом (минимум 0). */
export function durationMinutes(joinedAt: Date, leftAt: Date): number {
  return Math.max(0, Math.round((leftAt.getTime() - joinedAt.getTime()) / 60_000));
}

/**
 * Открывает запись посещаемости.
 *
 * Если у участника уже есть незакрытая запись по этому уроку (переподключение
 * сокета, вторая вкладка, обрыв сети) — переиспользуем её, чтобы не распухать
 * таблицей и не терять точность длительности.
 *
 * Возвращает id записи либо `null`, если писать не удалось: посещаемость —
 * вспомогательная функция, из-за неё урок не должен не запускаться.
 */
export async function openAttendance(params: {
  meetingId: string;
  userId: string;
  joinedAt?: Date;
}): Promise<string | null> {
  const joinedAt = params.joinedAt ?? new Date();

  try {
    const existing = await prisma.attendanceRecord.findFirst({
      where: {
        meetingId: params.meetingId,
        userId: params.userId,
        leftAt: null,
        joinedAt: { gte: new Date(joinedAt.getTime() - RESUME_WINDOW_MS) },
      },
      orderBy: { joinedAt: "desc" },
      select: { id: true },
    });

    if (existing) return existing.id;

    const created = await prisma.attendanceRecord.create({
      data: { meetingId: params.meetingId, userId: params.userId, joinedAt },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    console.error("[attendance] Не удалось открыть запись:", error);
    return null;
  }
}

/** Закрывает запись: фиксирует выход и считает длительность. */
export async function closeAttendance(recordId: string, leftAt: Date = new Date()): Promise<void> {
  try {
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      select: { joinedAt: true, leftAt: true },
    });
    if (!record || record.leftAt) return;

    await prisma.attendanceRecord.update({
      where: { id: recordId },
      data: { leftAt, durationMinutes: durationMinutes(record.joinedAt, leftAt) },
    });
  } catch (error) {
    console.error("[attendance] Не удалось закрыть запись:", error);
  }
}

/** Закрывает все открытые записи участника (например, при блокировке аккаунта). */
export async function closeAttendanceForUser(userId: string, schoolId: string, leftAt: Date = new Date()): Promise<number> {
  const tenant = schoolScope(schoolId);
  const open = await prisma.attendanceRecord.findMany({
    where: { userId, leftAt: null, user: { is: tenant }, meeting: { is: tenant } },
    select: { id: true, joinedAt: true },
  });

  await Promise.all(
    open.map((record) =>
      prisma.attendanceRecord
        .updateMany({
          where: { id: record.id, user: { is: tenant }, meeting: { is: tenant } },
          data: { leftAt, durationMinutes: durationMinutes(record.joinedAt, leftAt) },
        })
        .catch(() => undefined),
    ),
  );

  return open.length;
}

/** Закрывает все открытые записи урока (принудительное завершение). */
export async function closeMeetingAttendance(meetingId: string, schoolId: string, leftAt: Date = new Date()): Promise<number> {
  const tenant = schoolScope(schoolId);
  const open = await prisma.attendanceRecord.findMany({
    where: { meetingId, leftAt: null, meeting: { is: tenant } },
    select: { id: true, joinedAt: true },
  });

  await Promise.all(
    open.map((record) =>
      prisma.attendanceRecord
        .updateMany({
          where: { id: record.id, meeting: { is: tenant } },
          data: { leftAt, durationMinutes: durationMinutes(record.joinedAt, leftAt) },
        })
        .catch(() => undefined),
    ),
  );

  return open.length;
}

/**
 * Закрывает «зависшие» записи (сервер упал, сокет не успел сообщить о выходе).
 * Вызывается лениво из админских выборок; лучшая оценка — `leftAt = joinedAt`.
 */
export async function finishStaleAttendance(schoolId: string, now: Date = new Date()): Promise<number> {
  try {
    const tenant = schoolScope(schoolId);
    const result = await prisma.attendanceRecord.updateMany({
      where: { leftAt: null, joinedAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) }, meeting: { is: tenant }, user: { is: tenant } },
      data: { leftAt: now, durationMinutes: 0 },
    });
    return result.count;
  } catch (error) {
    console.error("[attendance] Не удалось закрыть зависшие записи:", error);
    return 0;
  }
}

export interface AttendanceRow {
  id: string;
  joinedAt: string;
  leftAt: string | null;
  durationMinutes: number;
  /** Запись ещё открыта — участник в комнате (или сессия не закрыта). */
  isLive: boolean;
  user: { id: string; name: string; role: Role; grade: GradeCode | null };
  meeting: { id: string; title: string; meetingCode: string };
}

export interface ListAttendanceOptions {
  schoolId: string;
  meetingId?: string;
  userId?: string;
  grade?: GradeCode;
  limit?: number;
  offset?: number;
}

/** Таблица посещаемости для админ-панели (свежие записи сверху). */
export async function listAttendance(options: ListAttendanceOptions): Promise<{
  items: AttendanceRow[];
  total: number;
  limit: number;
  offset: number;
}> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const where = {
    meeting: { is: schoolScope(options.schoolId) },
    user: { is: schoolScope(options.schoolId) },
    ...(options.meetingId ? { meetingId: options.meetingId } : {}),
    ...(options.userId ? { userId: options.userId } : {}),
    ...(options.grade ? { user: { is: { ...schoolScope(options.schoolId), grade: options.grade } } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where,
      orderBy: { joinedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        user: { select: { id: true, name: true, role: true, grade: true } },
        meeting: { select: { id: true, title: true, meetingCode: true } },
      },
    }),
    prisma.attendanceRecord.count({ where }),
  ]);

  return {
    total,
    limit,
    offset,
    items: rows.map((row) => ({
      id: row.id,
      joinedAt: row.joinedAt.toISOString(),
      leftAt: row.leftAt?.toISOString() ?? null,
      durationMinutes: row.durationMinutes,
      isLive: row.leftAt === null,
      user: {
        id: row.user.id,
        name: row.user.name,
        role: row.user.role as Role,
        grade: (row.user.grade as GradeCode | null) ?? null,
      },
      meeting: { id: row.meeting.id, title: row.meeting.title, meetingCode: row.meeting.meetingCode },
    })),
  };
}

/**
 * Закрывает «зависшие» записи посещаемости по ВСЕМ школам.
 *
 * Зачем отдельная функция: `finishStaleAttendance(schoolId)` вызывается лениво
 * из админских выборок, поэтому после падения сервера записи без `leftAt`
 * висят в отчётах месяцами, а «кто сейчас на уроке» показывает фантомов.
 * Вызывается один раз при старте (`runStartupMaintenance`), батчами, чтобы не
 * держать блокировку на большой таблице.
 */
export async function finishAllStaleAttendance(
  now: Date = new Date(),
  batchSize = 500,
): Promise<number> {
  let total = 0;
  try {
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
    for (let guard = 0; guard < 100; guard += 1) {
      const stale = await prisma.attendanceRecord.findMany({
        where: { leftAt: null, joinedAt: { lt: cutoff } },
        select: { id: true },
        take: batchSize,
      });
      if (stale.length === 0) break;

      const result = await prisma.attendanceRecord.updateMany({
        where: { id: { in: stale.map((row) => row.id) }, leftAt: null },
        data: { leftAt: now, durationMinutes: 0 },
      });
      total += result.count;
      if (stale.length < batchSize) break;
    }
    if (total > 0) console.warn(`[attendance] Закрыто зависших записей при старте: ${total}`);
  } catch (error) {
    console.error("[attendance] Не удалось закрыть зависшие записи при старте:", error);
  }
  return total;
}

/**
 * Возвращает «забытые» активные уроки в `idle`.
 *
 * После падения/редеплоя в БД остаётся `status = "active"` без единого сокета:
 * лобби и админ-панель показывают уроки, которых нет. Освобождаем только
 * комнаты, которые считаются активными дольше `STALE_AFTER_MS`, — занятия,
 * реально идущие на другом инстансе, не затрагиваются.
 */
export async function releaseStaleMeetings(now: Date = new Date()): Promise<number> {
  try {
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
    const result = await prisma.meeting.updateMany({
      where: {
        status: "active",
        OR: [{ callStartedAt: null }, { callStartedAt: { lt: cutoff } }, { startTime: { lt: cutoff } }],
      },
      data: { status: "idle", isActive: false, callStartedAt: null },
    });
    if (result.count > 0) console.warn(`[startup] Забытых активных уроков переведено в idle: ${result.count}`);
    return result.count;
  } catch (error) {
    console.error("[startup] Не удалось освободить зависшие уроки:", error);
    return 0;
  }
}
