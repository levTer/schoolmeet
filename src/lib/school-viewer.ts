import { prisma } from "@/lib/prisma";
import type { GradeCode } from "@/lib/schedule-rules";
import type { Role } from "@/types";

/** Минимальные данные о текущем пользователе, которые нужны расписанию и ДЗ. */
export interface SchoolViewer {
  id: string;
  role: Role;
  /** Класс ученика; для учителей и администраторов — null. */
  grade: GradeCode | null;
}

/**
 * Загружает класс пользователя из БД. Берём его из базы, а не из сессии,
 * чтобы смена класса вступала в силу сразу, без перевыпуска JWT.
 */
export async function getSchoolViewer(userId: string): Promise<SchoolViewer | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, grade: true },
  });
  if (!user) return null;

  return {
    id: user.id,
    role: user.role as Role,
    grade: (user.grade as GradeCode | null) ?? null,
  };
}
