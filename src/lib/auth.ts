import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcryptjs from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { GUARANTEED_ADMINS } from "@/lib/school-config";
import { ensureUserSchoolMembership, provisionConfiguredSchools } from "@/lib/schools";
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

/**
 * Email гарантированных администраторов настроенных школ (см. `GUARANTEED_ADMINS`
 * в `@/lib/school-config`). Никаких паролей здесь нет и быть не должно: список
 * нужен только чтобы понять, кого при отсутствии в БД надо инициализировать
 * через `provisionConfiguredSchools` — дальше вход идёт строго по bcrypt-хешу
 * из PostgreSQL, как для любого другого пользователя.
 */
const CONFIGURED_ADMIN_EMAILS: ReadonlySet<string> = new Set(
  GUARANTEED_ADMINS.map((admin) => admin.email.toLowerCase().trim()),
);

/**
 * Ищет пользователя по нормализованному email (вместе со школой).
 *
 * Основной путь — точное совпадение: он идёт по уникальному индексу `users.email`.
 * Если строки нет, повторяем поиск без учёта регистра: аккаунты, созданные до
 * нормализации email, могли сохранить «Ivan@School.ru», и такой пользователь
 * обязан войти по обычному «ivan@school.ru».
 */
async function findUserByEmail(cleanEmail: string) {
  const exact = await prisma.user.findFirst({
    where: { email: cleanEmail },
    include: { school: true },
  });
  if (exact) return exact;

  return prisma.user.findFirst({
    where: { email: { equals: cleanEmail, mode: "insensitive" } },
    include: { school: true },
  });
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
      name: "Лицей Сингулярити",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "ivan@school.ru" },
        password: { label: "Пароль", type: "password" },
      },

      /**
       * Проверяет email + пароль строго по PostgreSQL (Neon) и bcrypt-хешу.
       *
       * Никаких хардкод-паролей, обходов и «фальшивых» сессий: пользователь
       * существует только если есть строка в БД, пароль верен только если
       * `bcryptjs.compare` сошёлся с хешем из БД, а при недоступности БД
       * вход отклоняется (`null` → NextAuth покажет `CredentialsSignin`).
       *
       * Возвращает объект пользователя (NextAuth сериализует его в JWT)
       * либо `null` при любой неудаче. Каждая ветка логируется префиксами
       * `[AUTH]` / `[AUTH_FAIL]` / `[AUTH_SUCCESS]` / `[AUTH_ERROR]` —
       * по ним в логах продакшена видна точная причина отказа.
       */
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          console.log('[AUTH] Missing credentials');
          return null;
        }

        const cleanEmail = credentials.email.toLowerCase().trim();
        const password = credentials.password;

        if (!cleanEmail) {
          console.log('[AUTH] Missing credentials');
          return null;
        }

        try {
          console.log(`[AUTH] Login attempt for: ${cleanEmail}`);

          // 1. Поиск пользователя в PostgreSQL
          let user = await findUserByEmail(cleanEmail);

          // 2. Если это дефолтный админ, но его еще нет в БД — инициализируем его В БАЗЕ ДАННЫХ
          if (!user && CONFIGURED_ADMIN_EMAILS.has(cleanEmail)) {
            console.log(`[AUTH] Initializing missing admin in DB for: ${cleanEmail}`);
            await provisionConfiguredSchools(); // Гарантирует создание школ и пользователей в Neon
            user = await findUserByEmail(cleanEmail);
          }

          if (!user) {
            console.log(`[AUTH_FAIL] User not found in DB: ${cleanEmail}`);
            return null;
          }

          if (user.isBanned) {
            console.log(`[AUTH_FAIL] User is banned: ${cleanEmail}`);
            return null;
          }

          // 3. Строгая проверка пароля из ХЕША В БАЗЕ ДАННЫХ
          const isPasswordValid = await bcryptjs.compare(password, user.password);
          if (!isPasswordValid) {
            console.log(`[AUTH_FAIL] Invalid password for: ${cleanEmail}`);
            return null;
          }

          console.log(`[AUTH_SUCCESS] User authenticated: ${cleanEmail} (${user.role})`);

          // Старые аккаунты без школы мигрируем в школу по умолчанию до
          // выпуска JWT (как и раньше); свежие записи уже имеют schoolId.
          let schoolId = user.schoolId;
          let classId = user.classId;
          if (!schoolId) {
            const membership = await ensureUserSchoolMembership(user.id);
            if (membership) {
              schoolId = membership.schoolId;
              classId = membership.classId;
            }
          }

          // Пароль-хеш наружу не отдаём; в сессию попадают только данные из БД.
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role as Role,
            schoolId,
            classId,
            image: user.avatar ?? null,
          };
        } catch (error) {
          console.error(`[AUTH_ERROR] Critical DB or Auth error for ${cleanEmail}:`, error);
          return null;
        }
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
