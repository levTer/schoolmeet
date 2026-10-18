import type { Role } from "@/types";

/**
 * Единое правило доступа к комнате урока (H-02).
 *
 * Правило используется и HTTP-слоем (`/api/meetings/[code]`, страница
 * `/meeting/[id]`), и Socket.IO-сервером (`join-room`), чтобы проверка не
 * «дрейфовала» между транспортами: раньше socket и API сверяли только школу,
 * из-за чего ученик другого класса той же школы мог войти в урок по коду.
 *
 * Модуль чистый (без Prisma и Node API) — его можно вызывать из тестов и из
 * edge-совместимого кода. Тенант урока (`schoolId`) вычисляет вызывающая
 * сторона через `getMeetingSchoolId()` из `@/lib/schools`.
 */

/** Урок с точки зрения доступа: школа-владелец и класс расписания. */
export interface MeetingAccessSubject {
  /** Школа-владелец урока (`meeting.schoolId ?? schedule.schoolId ?? host.schoolId`). */
  schoolId: string | null;
  /**
   * Класс, к которому урок привязан расписанием (`schedule.classId`).
   * `null` — внеплановая/общешкольная встреча, доступная всей школе.
   */
  scheduleClassId?: string | null;
  /** Ведущий урока (учитель, создавший комнату). */
  hostId?: string | null;
  /**
   * Политика школы (`School.strictClassIsolation`):
   *  - `true`  (STRICT)   — STUDENT обязан состоять в классе расписания
   *    (отдельный допуск по коду класса проверяет вызывающая сторона —
   *    `checkMeetingAccess` в `@/lib/meetings`);
   *  - `false`/отсутствует (FLEXIBLE) — STUDENT заходит на любые уроки
   *    своей школы.
   */
  strictClassIsolation?: boolean;
}

/** Проверяемый участник: роль, школа и класс из БД (не из запроса клиента). */
export interface MeetingAccessViewer {
  id?: string;
  role: Role;
  schoolId: string | null;
  classId: string | null;
}

export type MeetingAccessCode = "SCHOOL_MISMATCH" | "CLASS_FORBIDDEN";

export interface MeetingAccessDenied {
  ok: false;
  code: MeetingAccessCode;
  /** HTTP-статус для ответа API (socket использует только `code`). */
  status: 403 | 404;
  message: string;
}

export type MeetingAccessDecision = { ok: true } | MeetingAccessDenied;

/** Учитель и администратор школы видят все уроки своей школы. */
export function isSchoolStaff(role: Role): boolean {
  return role === "TEACHER" || role === "ADMIN";
}

/**
 * Разрешён ли вход в урок.
 *
 * Порядок проверок (fail-closed — любой пробел в данных = отказ):
 *  1. школа урока и школа зрителя обязаны существовать и совпадать
 *     (иначе `404 SCHOOL_MISMATCH`: чужой урок не должен даже подтверждать
 *     своё существование);
 *  2. урок без класса расписания открыт всей школе;
 *  3. учитель и администратор школы допущены к любому уроку своей школы
 *     (всегда, независимо от политики — тестовые `admin@` / `fullhouse@`
 *     входят во все уроки своей школы);
 *  4. политика школы:
 *     - FLEXIBLE (по умолчанию) — любой STUDENT школы заходит;
 *     - STRICT — STUDENT обязан состоять в классе расписания
 *       (`403 CLASS_FORBIDDEN`); разовый допуск по коду класса проверяет
 *       вызывающая сторона (`checkMeetingAccess` в `@/lib/meetings`),
 *       потому что для этого нужны БД и HMAC, а модуль остаётся чистым.
 */
export function resolveMeetingAccess(
  meeting: MeetingAccessSubject,
  viewer: MeetingAccessViewer,
): MeetingAccessDecision {
  if (!meeting.schoolId || !viewer.schoolId || meeting.schoolId !== viewer.schoolId) {
    return {
      ok: false,
      code: "SCHOOL_MISMATCH",
      status: 404,
      message: "Этот урок принадлежит другой школе",
    };
  }

  const scheduleClassId = meeting.scheduleClassId ?? null;

  // Внеплановая встреча (без класса в расписании) открыта всей школе.
  if (!scheduleClassId) return { ok: true };

  // Учитель и администратор школы допущены к любому уроку своей школы.
  if (isSchoolStaff(viewer.role)) return { ok: true };

  // Ведущий урока заходит всегда (на случай смены роли на STUDENT).
  if (meeting.hostId && viewer.id && meeting.hostId === viewer.id) return { ok: true };

  // Гибкая школа: любой ученик школы заходит на любые её уроки.
  if (meeting.strictClassIsolation !== true) return { ok: true };

  // Строгая школа: только ученики класса расписания.
  if (!viewer.classId || viewer.classId !== scheduleClassId) {
    return {
      ok: false,
      code: "CLASS_FORBIDDEN",
      status: 403,
      message: "Этот урок запланирован для другого класса",
    };
  }

  return { ok: true };
}
