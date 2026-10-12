import { prisma } from "@/lib/prisma";
import { ensureUserSchoolMembership } from "@/lib/schools";
import type { GradeCode } from "@/lib/schedule-rules";
import type { Role } from "@/types";

/** Минимальные данные о текущем пользователе, нужные расписанию и ДЗ. */
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
 * Если старый аккаунт ещё не привязан к школе, мигрирует его в SCHOOL1.
 */
export async function getSchoolViewer(userId: string): Promise<SchoolViewer | null> {
  await ensureUserSchoolMembership(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      grade: true,
      schoolId: true,
      classId: true,
      schoolClass: { select: { name: true } },
      isBanned: true,
    },
  });
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
