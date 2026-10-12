import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { LOGIN_ERROR } from "@/lib/auth-errors";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { ensureUserSchoolMembership } from "@/lib/schools";
import { normalizeEmail } from "@/lib/validation";
import type { Role } from "@/types";

/** Сессия живёт 30 дней и продлевается при активности пользователя. */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Как часто сверять роль и блокировку с БД.
 *
 * JWT хранит роль на момент входа, поэтому бан или смена роли должны
 * «догонять» активную сессию. Раз в минуту токен обновляется из БД — это
 * компромисс между мгновенной реакцией и лишними запросами (почти все
 * действия через API и так проверяются по БД, см. `requireViewer`).
 */
export const SESSION_REFRESH_MS = 60_000;

/**
 * Роли, которым открыт раздел `/admin` (см. также `src/middleware.ts`).
 *
 * Доступ строго у суперадмина: учителя (TEACHER) и ученики (STUDENT) получают
 * редирект `/dashboard?denied=admin` и toast «Доступ открыт только
 * Администратору школы». Учитель сохраняет ВСЕ свои функции (расписание, ДЗ с ИИ,
 * видеозвонки, ИИ-доска) — они живут вне админ-панели.
 */
export const ADMIN_AREA_ROLES: readonly Role[] = ["ADMIN"];

/** Разрешён ли вход в админ-панель: только роль ADMIN. */
export function canAccessAdminArea(role?: Role | null): boolean {
  return role === "ADMIN";
}

export const authOptions: NextAuthOptions = {
  /* Сессия хранится в подписанном JWT-cookie — это позволяет проверять
     авторизацию в middleware (edge-рантайм) без запросов в БД. */
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE,
  },

  secret: process.env.NEXTAUTH_SECRET,

  pages: {
    signIn: "/login",
    error: "/login",
  },

  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "SchoolMeet",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "ivan@school.ru" },
        password: { label: "Пароль", type: "password" },
      },

      /**
       * Проверяет email + пароль.
       *
       * Возвращает объект пользователя (NextAuth сериализует его в JWT) либо
       * бросает ошибку с коротким кодом — клиент покажет понятный текст:
       * «Пользователь с таким email не найден», «Неверный пароль».
       */
      async authorize(credentials) {
        const email = normalizeEmail(credentials?.email ?? "");
        const password = credentials?.password ?? "";

        if (!email || !password) {
          throw new Error(LOGIN_ERROR.missingCredentials);
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          throw new Error(LOGIN_ERROR.userNotFound);
        }

        const isPasswordValid = await verifyPassword(password, user.password);
        if (!isPasswordValid) {
          throw new Error(LOGIN_ERROR.invalidPassword);
        }

        // Заблокированный аккаунт не может войти: даже с верным паролем.
        if (user.isBanned) {
          throw new Error(LOGIN_ERROR.accountBanned);
        }

        // Мигрируем старые аккаунты в школу по умолчанию до выпуска JWT.
        const membership = await ensureUserSchoolMembership(user.id);
        if (!membership) throw new Error(LOGIN_ERROR.userNotFound);

        // Пароль-хеш наружу не отдаём; в сессию попадают только данные членства.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as Role,
          schoolId: membership.schoolId,
          classId: membership.classId,
          image: user.avatar ?? null,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * Дополняет JWT: при входе кладём `id` и `role`, чтобы middleware и
     * серверные компоненты видели роль без обращения к БД.
     */
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user.role as Role) ?? "STUDENT";
        token.schoolId = user.schoolId ?? null;
        token.classId = user.classId ?? null;
        token.name = user.name ?? token.name;
        token.email = user.email ?? token.email;
        token.picture = user.image ?? null;
        token.banned = false;
        token.syncedAt = Date.now();
        return token;
      }

      const userId = typeof token.id === "string" && token.id ? token.id : token.sub;
      const needsSync =
        // Явное обновление сессии (например, после повышения до ADMIN по
        // секретной ссылке) требует свежей роли немедленно, без ожидания 60 с.
        trigger === "update" ||
        !token.role ||
        token.schoolId === undefined ||
        token.classId === undefined ||
        Date.now() - (typeof token.syncedAt === "number" ? token.syncedAt : 0) > SESSION_REFRESH_MS;

      /**
       * Сверка с БД: смена роли, имени и блокировка применяются к уже вошедшим
       * пользователям (не чаще одного раза в минуту). Страховка для cookie,
       * выпущенных до появления поля role, работает на этом же запросе.
       */
      if (userId && needsSync) {
        try {
          let dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, name: true, avatar: true, isBanned: true, schoolId: true, classId: true },
          });

          if (dbUser && (!dbUser.schoolId || (dbUser.role === "STUDENT" && !dbUser.classId))) {
            await ensureUserSchoolMembership(userId);
            dbUser = await prisma.user.findUnique({
              where: { id: userId },
              select: { role: true, name: true, avatar: true, isBanned: true, schoolId: true, classId: true },
            });
          }

          if (dbUser) {
            token.id = userId;
            token.role = dbUser.role as Role;
            token.schoolId = dbUser.schoolId;
            token.classId = dbUser.classId;
            token.name = dbUser.name;
            token.picture = dbUser.avatar ?? null;
            token.banned = dbUser.isBanned;
          }
        } catch (error) {
          // БД недоступна — не ломаем сессию, просто не обновляем данные.
          console.error("[auth] Не удалось обновить данные сессии:", error);
        }
        token.syncedAt = Date.now();
      }

      return token;
    },

    /** Отдаёт приложению `session.user.id` и `session.user.role`. */
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string | undefined) ?? token.sub ?? "";
        session.user.role = (token.role as Role | undefined) ?? "STUDENT";
        session.user.schoolId = typeof token.schoolId === "string" ? token.schoolId : null;
        session.user.classId = typeof token.classId === "string" ? token.classId : null;
        session.user.banned = token.banned === true;

        if (typeof token.name === "string") session.user.name = token.name;
        if (typeof token.email === "string") session.user.email = token.email;
        session.user.image = typeof token.picture === "string" ? token.picture : null;
      }

      return session;
    },
  },

  debug: process.env.NODE_ENV === "development",
};
