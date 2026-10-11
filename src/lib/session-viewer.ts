import { getServerSession } from "next-auth";

import { DomainError, forbidden } from "@/lib/api";
import { authOptions } from "@/lib/auth";
import { getSchoolViewer, type SchoolViewer } from "@/lib/school-viewer";
import type { Role } from "@/types";

/** Текущий пользователь для API-роутов. Без сессии — 401. */
export async function requireViewer(): Promise<SchoolViewer> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new DomainError(401, "UNAUTHORIZED", "Войдите в аккаунт");
  }

  const viewer = await getSchoolViewer(session.user.id);
  if (!viewer) throw new DomainError(401, "UNAUTHORIZED", "Аккаунт не найден");
  return viewer;
}

/** Пускает только перечисленные роли, остальным — 403. */
export function requireRole(viewer: SchoolViewer, roles: readonly Role[], message?: string): void {
  if (!roles.includes(viewer.role)) throw forbidden(message);
}
