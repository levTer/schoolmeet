import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { LOGIN_ERROR } from "@/lib/auth-errors";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/validation";
import type { Role } from "@/types";

/** Сессия живёт 30 дней и продлевается при активности пользователя. */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/** Роли, которым открыт раздел `/admin` (см. также `src/middleware.ts`). */
export const ADMIN_AREA_ROLES: readonly Role[] = ["ADMIN", "TEACHER"];

export function canAccessAdminArea(role?: Role | null): boolean {
  return role != null && ADMIN_AREA_ROLES.includes(role);
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

        // Пароль-хеш наружу не отдаём: в сессию уходят только id/role/имя.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as Role,
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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user.role as Role) ?? "STUDENT";
        token.name = user.name ?? token.name;
        token.email = user.email ?? token.email;
        token.picture = user.image ?? null;
        return token;
      }

      // Страховка для cookie, выпущенных до появления поля role.
      if (!token.role && token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true, name: true, avatar: true },
        });

        if (dbUser) {
          token.id = token.sub;
          token.role = dbUser.role as Role;
          token.name = dbUser.name;
          token.picture = dbUser.avatar ?? null;
        }
      }

      return token;
    },

    /** Отдаёт приложению `session.user.id` и `session.user.role`. */
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string | undefined) ?? token.sub ?? "";
        session.user.role = (token.role as Role | undefined) ?? "STUDENT";

        if (typeof token.name === "string") session.user.name = token.name;
        if (typeof token.email === "string") session.user.email = token.email;
        session.user.image = typeof token.picture === "string" ? token.picture : null;
      }

      return session;
    },
  },

  debug: process.env.NODE_ENV === "development",
};
