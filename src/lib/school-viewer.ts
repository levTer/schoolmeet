import { prisma } from "@/lib/prisma";
import { ensureUserSchoolMembership } from "@/lib/schools";
import type { GradeCode } from "@/lib/schedule-rules";
import type { Role } from "@/types";

/** Минимальные данные о текущем пользователе, нужные расписанию и ДЗ. */
const VIEWER_SELECT = {
  id: true,
  role: true,
  grade: true,
  schoolId: true,
  classId: true,
  schoolClass: { select: { name: true } },
  isBanned: true,
} as const;

export interface SchoolViewer {
  id: string;
  role: Role;
  schoolId: string | null;
  classId: string | null;
  className: string | null;
  /** Параллель остаётся для совместимости с существующими UI и данными. */
  grade: GradeCode | null;
  /** Аккаунт заблокирован администратором. */
  isBanned: boolean;
}

/**
 * Загружает роль, школу, класс и блокировку из БД, а не из клиентского запроса.
 * Если старый аккаунт ещё не привязан к школе, мигрирует его в основную школу.
 */
export async function getSchoolViewer(userId: string): Promise<SchoolViewer | null> {
  /**
   * Быстрый путь: один запрос, если аккаунт уже привязан к школе (а ученик —
   * к классу). `ensureUserSchoolMembership` — тяжёлая операция (проверка школ,
   * досыпка класса, повторное чтение), поэтому вызываем её ТОЛЬКО для legacy-
   * аккаунтов. Раньше она вызывалась всегда: +2 запроса к БД на каждый
   * защищённый API-вызов и на каждый сокет-рукопожатие.
   */
  let user = await prisma.user.findUnique({ where: { id: userId }, select: VIEWER_SELECT });

  const needsMembership =
    user !== null && (!user.schoolId || (user.role === "STUDENT" && !user.classId));

  if (needsMembership) {
    await ensureUserSchoolMembership(userId);
    user = await prisma.user.findUnique({ where: { id: userId }, select: VIEWER_SELECT });
  }

  if (!user) return null;

  return {
    id: user.id,
    role: user.role as Role,
    schoolId: user.schoolId,
    classId: user.classId,
    className: user.schoolClass?.name ?? null,
    grade: (user.grade as GradeCode | null) ?? null,
    isBanned: user.isBanned,
  };
}
