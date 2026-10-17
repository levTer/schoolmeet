import type { DefaultSession } from "next-auth";

import type { Role } from "./index";

/**
 * Расширяем типы NextAuth, чтобы `session.user` содержал роль и принадлежность к школе.
 * Используется в этапе 2 (авторизация и защита маршрутов).
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      schoolId: string | null;
      classId: string | null;
      /** Название школы пользователя — для динамического брендинга UI. */
      schoolName?: string | null;
      /** Аккаунт заблокирован администратором. */
      banned: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    schoolId?: string | null;
    classId?: string | null;
    /** Название школы пользователя (приходит из `authorize` вместе с профилем). */
    schoolName?: string | null;
    /** Школа из Prisma (`include: { school: true }`) — чтобы не терять имя. */
    school?: { name?: string | null } | null;
    /**
     * Версия сессии: растёт при смене пароля или роли, чтобы ранее выпущенные
     * JWT переставали приниматься (см. `src/lib/auth.ts`).
     */
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    schoolId?: string | null;
    classId?: string | null;
    /** Название школы — кешируется в токене для шапки и дашборда. */
    schoolName?: string | null;
    /** Кешированный признак блокировки (обновляется раз в минуту). */
    banned?: boolean;
    /** Когда роль и блокировка последний раз сверялись с БД. */
    syncedAt?: number;
    /**
     * Версия сессии на момент выпуска токена (`User.sessionVersion`).
     * Расхождение с БД означает, что пароль или роль менялись — токен
     * аннулируется jwt-callback'ом.
     */
    sessionVersion?: number;
  }
}
