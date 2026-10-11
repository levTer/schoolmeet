import { getServerSession } from "next-auth";

import { DomainError, forbidden } from "@/lib/api";
import { adminDenyReason, type AdminCapability, type AdminTarget } from "@/lib/admin-permissions";
import { authOptions } from "@/lib/auth";
import { getSchoolViewer, type SchoolViewer } from "@/lib/school-viewer";
import type { Role } from "@/types";

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
