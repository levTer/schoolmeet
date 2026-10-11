import type { DefaultSession } from "next-auth";

import type { Role } from "./index";

/**
 * Расширяем типы NextAuth, чтобы `session.user` содержал роль SchoolMeet.
 * Используется в этапе 2 (авторизация и защита маршрутов).
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      /** Аккаунт заблокирован администратором (этап 6). */
      banned: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    /** Кешированный признак блокировки (обновляется раз в минуту). */
    banned?: boolean;
    /** Когда роль и блокировка последний раз сверялись с БД. */
    syncedAt?: number;
  }
}
