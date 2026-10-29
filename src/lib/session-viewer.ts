import { getServerSession } from "next-auth";

import { DomainError, forbidden, tenantRequired } from "@/lib/api";
import { adminDenyReason, type AdminCapability, type AdminTarget } from "@/lib/admin-permissions";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSchoolViewer, type SchoolViewer } from "@/lib/school-viewer";
import type { Role } from "@/types";

/** Зритель, у которого школа подтверждена сессией (tenant обязателен). */
export type TenantViewer = SchoolViewer & { schoolId: string };
export type TenantAdminViewer = TenantViewer & { role: "ADMIN" };

/** Read the current admin directly: never provision a default tenant for admin access. */
async function readLiveAdmin(userId: string): Promise<TenantAdminViewer | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, role: "ADMIN", isBanned: false, school: { isNot: null } },
    select: {
      id: true, role: true, schoolId: true, classId: true, isBanned: true,
      grade: true, schoolClass: { select: { name: true } },
    },
  });
  if (!user?.schoolId?.trim()) return null;
  return {
    id: user.id, role: "ADMIN", schoolId: user.schoolId, classId: user.classId,
    className: user.schoolClass?.name ?? null, grade: user.grade, isBanned: user.isBanned,
  };
}

/**
 * Текущий пользователь для API-роутов. Без сессии — 401.
 *
 * Блокировка проверяется здесь же: JWT мог быть выпущен до бана, поэтому
 * «живая» проверка по БД — единственная надёжная точка контроля.
 */
export async function requireViewer(): Promise<SchoolViewer> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new DomainError(401, "UNAUTHORIZED", "Войдите в аккаунт");
  }

  const viewer = await getSchoolViewer(session.user.id);
  if (!viewer) throw new DomainError(401, "UNAUTHORIZED", "Аккаунт не найден");
  if (viewer.isBanned) {
    throw new DomainError(403, "ACCOUNT_BANNED", "Аккаунт заблокирован администратором");
  }
  return viewer;
}

/**
 * То же, что `requireViewer`, но с гарантированной школой (tenant).
 *
 * Любой маршрут, работающий с данными школы (объявления, расписание, уроки,
 * ДЗ), обязан вызывать именно его. Если у сессии нет `schoolId`, доступ
 * запрещается (403 `SCHOOL_REQUIRED`) — маршрут не может взять школу из тела
 * запроса, query или «догадаться» про основную школу.
 */
export async function requireSchoolViewer(): Promise<TenantViewer> {
  const viewer = await requireViewer();
  if (!viewer.schoolId) throw tenantRequired();
  return viewer as TenantViewer;
}

/**
 * Живая проверка администратора для СЕРВЕРНЫХ СТРАНИЦ (исправление H-01).
 *
 * Роль, бан и школа читаются из БД, а не из JWT-cookie: страницы `/admin`
 * раньше доверяли `session.user.role` и потому принимали claim, попавший в
 * токен при сбое сверки с БД. Если БД недоступна — доступ закрыт (fail-closed):
 * админ-данные без подтверждённых прав не выдаются.
 */
export async function getLiveAdminViewer(): Promise<TenantAdminViewer | null> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return null;
    return await readLiveAdmin(session.user.id);
  } catch (error) {
    console.error("[session-viewer] Не удалось подтвердить права администратора:", error);
    return null;
  }
}

/** Every admin API must use this guard; a layout is not an authorization boundary. */
export async function requireAdminViewer(): Promise<TenantAdminViewer> {
  let viewer: TenantAdminViewer | null;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) throw new DomainError(401, "UNAUTHORIZED", "Войдите в аккаунт");
    viewer = await readLiveAdmin(session.user.id);
  } catch (error) {
    if (error instanceof DomainError && error.status === 401) throw error;
    console.error("[session-viewer] Проверка администратора не выполнена:", error);
    throw forbidden("Не удалось подтвердить права администратора");
  }
  if (!viewer) throw forbidden("Требуется действующий администратор с подтверждённой школой");
  return viewer;
}

/** Пускает только перечисленные роли, остальным — 403. */
export function requireRole(viewer: SchoolViewer, roles: readonly Role[], message?: string): void {
  if (!roles.includes(viewer.role)) throw forbidden(message);
}

/**
 * Проверяет право на действие в админ-панели (см. `admin-permissions.ts`).
 * Для учителя права зависят от цели — например, модерировать можно только учеников.
 */
export function requireCapability(
  viewer: SchoolViewer,
  capability: AdminCapability,
  target?: AdminTarget,
): void {
  const reason = adminDenyReason({ id: viewer.id, role: viewer.role }, capability, target);
  if (reason) throw forbidden(reason);
}
