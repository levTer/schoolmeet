import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcryptjs from "bcryptjs";

import {
  SessionRevokedError,
  applyDatabaseSnapshot,
  isSessionAuthoritative,
  keepSessionOnDatabaseError,
  sessionRevocationReason,
  shouldSyncSession,
  type DatabaseUserSnapshot,
  type SessionToken,
} from "@/lib/auth-token";
import { writeAuditLog } from "@/lib/audit";
import { isTwoFactorEnabled, verifySecondFactor } from "@/lib/two-factor";
import { loginLockStatus, registerLoginFailure, resetLoginFailures } from "@/lib/login-guard";
import { prisma } from "@/lib/prisma";
import { GUARANTEED_ADMINS, demoAdminSeedDisabled } from "@/lib/school-config";
import { ensureUserSchoolMembership, provisionConfiguredSchools } from "@/lib/schools";
import type { Role } from "@/types";

/** Сессия живёт 30 дней и продлевается при активности пользователя. */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Как долго уже подтверждённая БД сессия живёт без повторной сверки, если база
 * недоступна (сутки). Fail-closed: по истечении этого окна токен без свежей
 * сверки аннулируется, чтобы недоступная БД не консервировала устаревшие права.
 */
export const SESSION_SYNC_GRACE_MS = 24 * 60 * 60 * 1000;

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
 * Троттлинг записи входов в журнал аудита: одна запись на пользователя в час.
 * Полный список входов нужен службе безопасности, но он не должен превращаться
 * в запись в БД на каждый refresh сессии.
 */
const LOGIN_AUDIT_INTERVAL_MS = 60 * 60_000;
const lastLoginAuditAt = new Map<string, number>();

function shouldWriteLoginAudit(userId: string, now: number = Date.now()): boolean {
  const previous = lastLoginAuditAt.get(userId) ?? 0;
  if (now - previous < LOGIN_AUDIT_INTERVAL_MS) return false;
  if (lastLoginAuditAt.size > 5_000) lastLoginAuditAt.clear();
  lastLoginAuditAt.set(userId, now);
  return true;
}

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

/**
 * Авторитетный срез пользователя для сессии (роль, школа, класс, бан, версия).
 *
 * Единственная точка, где привилегии токена подтверждаются БД. Старые аккаунты
 * без школы/класса предварительно мигрируются в школу по умолчанию — иначе
 * сессия без tenant была бы «дыркой» в изоляции данных.
 */
async function loadUserForSession(userId: string): Promise<DatabaseUserSnapshot | null> {
  const select = {
    role: true,
    name: true,
    avatar: true,
    isBanned: true,
    schoolId: true,
    classId: true,
    sessionVersion: true,
    school: { select: { name: true } },
  } as const;

  let dbUser = await prisma.user.findUnique({ where: { id: userId }, select });

  if (dbUser && (!dbUser.schoolId || (dbUser.role === "STUDENT" && !dbUser.classId))) {
    await ensureUserSchoolMembership(userId);
    dbUser = await prisma.user.findUnique({ where: { id: userId }, select });
  }

  if (!dbUser) return null;

  return {
    role: dbUser.role as Role,
    name: dbUser.name,
    avatar: dbUser.avatar,
    isBanned: dbUser.isBanned,
    schoolId: dbUser.schoolId,
    classId: dbUser.classId,
    schoolName: dbUser.school?.name ?? null,
    sessionVersion: dbUser.sessionVersion ?? 0,
  };
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
        // Второй фактор (TOTP или резервный код). Обязателен, если у аккаунта
        // включена 2FA; для остальных аккаунтов поле просто игнорируется.
        twoFactorCode: { label: "Код подтверждения", type: "text" },
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
        if (!credentials?.email || !credentials?.password) return null;

        const cleanEmail = credentials.email.toLowerCase().trim();
        const password = credentials.password;
        if (!cleanEmail) return null;

        /**
         * Пароль и email НЕ логируются никогда: логи хостинга — не место для
         * персональных данных школьников. В журнал попадают только машинные
         * коды причин отказа.
         */
        try {
          // 0. Блокировка после серии неудачных попыток (защита от перебора).
          const lock = loginLockStatus(cleanEmail);
          if (lock.locked) {
            console.warn(`[AUTH_FAIL] ACCOUNT_LOCKED retry_after=${lock.retryAfterSeconds}s`);
            return null;
          }

          // 1. Поиск пользователя в PostgreSQL
          let user = await findUserByEmail(cleanEmail);

          // 2. Bootstrap-админ ещё не создан (пустая база) — инициализируем.
          //    Если инициализация отключена оператором, НИЧЕГО не создаём:
          //    вход в чужой тенант невозможен без явного согласия владельца.
          if (!user && CONFIGURED_ADMIN_EMAILS.has(cleanEmail) && !demoAdminSeedDisabled()) {
            console.warn('[AUTH] Bootstrap provisioning для настроенного администратора');
            await provisionConfiguredSchools();
            user = await findUserByEmail(cleanEmail);
          }

          if (!user) {
            registerLoginFailure(cleanEmail);
            console.warn('[AUTH_FAIL] USER_NOT_FOUND');
            return null;
          }

          if (user.isBanned) {
            console.warn('[AUTH_FAIL] ACCOUNT_BANNED');
            return null;
          }

          // 3. Строгая проверка пароля из ХЕША В БАЗЕ ДАННЫХ
          const isPasswordValid = await bcryptjs.compare(password, user.password);
          if (!isPasswordValid) {
            const status = registerLoginFailure(cleanEmail);
            console.warn(
              `[AUTH_FAIL] INVALID_PASSWORD failures=${status.failures}${status.locked ? ` locked_for=${status.retryAfterSeconds}s` : ""}`,
            );
            return null;
          }

          /*
           * Второй фактор: пароль уже верен, но при включённой 2FA сессии ещё
           * нет. Неверный/отсутствующий код считается неудачной попыткой входа
           * (тот же счётчик и та же блокировка, что и для пароля), иначе
           * шестизначный код можно было бы перебирать без ограничений.
           */
          if (isTwoFactorEnabled(user)) {
            const rawCode = typeof credentials.twoFactorCode === "string" ? credentials.twoFactorCode : "";
            const secondFactor = await verifySecondFactor(user, rawCode);
            if (!secondFactor.ok) {
              const status = registerLoginFailure(cleanEmail);
              console.warn(
                `[AUTH_FAIL] TWO_FACTOR_${secondFactor.reason} failures=${status.failures}${status.locked ? ` locked_for=${status.retryAfterSeconds}s` : ""}`,
              );
              return null;
            }
            console.warn(`[AUTH_2FA] method=${secondFactor.method}`);
          }

          // Успешный вход (оба фактора) сбрасывает счётчик провалов.
          resetLoginFailures(cleanEmail);
          console.warn(`[AUTH_SUCCESS] role=${user.role}`);

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

          // Вход в журнал аудита. Best-effort: запись не должна блокировать вход,
          // а `writeAuditLog` сам глотает ошибки. Журнал тенант-скоупный, поэтому
          // пишем только когда школа известна (у legacy-аккаунта её может не быть).
          if (schoolId && shouldWriteLoginAudit(user.id)) {
            await writeAuditLog({
              userId: user.id,
              schoolId,
              action: "auth.login",
              details: { role: user.role },
            });
          }

          // Пароль-хеш наружу не отдаём; в сессию попадают только данные из БД.
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role as Role,
            schoolId,
            classId,
            schoolName: user.school?.name ?? null,
            school: user.school ? { name: user.school.name } : null,
            image: user.avatar ?? null,
            sessionVersion: user.sessionVersion ?? 0,
          };
        } catch (error) {
          // Здесь тоже не печатаем email: только тип ошибки.
          console.error('[AUTH_ERROR] Critical DB or Auth error:', error);
          return null;
        }
      },
    }),
  ],

  callbacks: {
    /**
     * Дополняет JWT: при входе кладём `id` и `role`, чтобы middleware и
     * серверные компоненты видели роль без обращения к БД.
     *
     * Fail-closed контракт (исправление H-01):
     *  1. роль, школа, класс и блокировка берутся **только** из БД; payload из
     *     `useSession().update()` считается недоверенным и не копируется в
     *     токен (раньше `session.user.role` попадал в JWT до запроса к БД и
     *     оставался там, если запрос падал);
     *  2. удалённый или заблокированный пользователь теряет сессию — callback
     *     выбрасывает `SessionRevokedError`, NextAuth чистит session-cookie, а
     *     `getServerSession` возвращает `null`;
     *  3. при ошибке БД `syncedAt` не обновляется (следующий запрос снова
     *     попытается свериться), а токен без подтверждённых БД привилегий
     *     аннулируется;
     *  4. смена пароля или роли поднимает `User.sessionVersion` — старый JWT с
     *     другой версией больше не принимается (исправление H-06).
     */
    async jwt({ token, user, trigger }) {
      const now = Date.now();
      const current = token as unknown as SessionToken;

      // Fail-closed: токена нет — сессия аннулируется.
      if (!current) throw new SessionRevokedError("NO_TOKEN");

      /**
       * Свежий вход: данные получены из БД в `authorize()`, поэтому им доверяем.
       * Ниже они всё равно будут подтверждены повторным чтением при первом
       * обращении к сессии.
       */
      if (user) {
        current.id = user.id;
        current.role = (user.role as Role) || "STUDENT";
        current.schoolId = user.schoolId ?? null;
        current.classId = user.classId ?? null;
        current.schoolName = user.school?.name || user.schoolName || null;
        current.name = user.name ?? current.name;
        current.email = user.email ?? current.email;
        current.picture = user.image ?? null;
        current.banned = false;
        current.sessionVersion = user.sessionVersion ?? 0;
        current.syncedAt = now;
      }

      const userId = typeof current.id === "string" && current.id ? current.id : current.sub;
      if (!userId) throw new SessionRevokedError("NO_SUBJECT");

      if (!shouldSyncSession(current, { trigger, now, refreshMs: SESSION_REFRESH_MS })) {
        return current as never;
      }

      let dbUser: DatabaseUserSnapshot | null = null;
      try {
        dbUser = await loadUserForSession(userId);
      } catch (error) {
        /**
         * БД недоступна. Fail-closed: токен, чьи привилегии ещё не подтверждены
         * БД, аннулируется — иначе при `trigger === "update"` в момент сбоя в
         * JWT остались бы непроверенные claims (исходная уязвимость H-01).
         * Подтверждённый токен живёт до `SESSION_SYNC_GRACE_MS`, но `syncedAt`
         * не сдвигается, поэтому следующая попытка сверки будет сразу.
         */
        console.error("[auth] Не удалось сверить сессию с БД:", error);
        if (!keepSessionOnDatabaseError(current, { now, graceMs: SESSION_SYNC_GRACE_MS })) {
          throw new SessionRevokedError("SYNC_FAILED");
        }
        return current as never;
      }

      // Пользователь удалён, заблокирован или его пароль/роль менялись:
      // ранее выпущенный токен больше не действует.
      if (!dbUser) {
        console.warn(`[auth] Сессия аннулирована: пользователь ${userId} не найден`);
        throw new SessionRevokedError("USER_DELETED");
      }

      const revoked = sessionRevocationReason(dbUser, current);
      if (revoked) {
        console.warn(`[auth] Сессия аннулирована (${revoked}) для пользователя ${userId}`);
        throw new SessionRevokedError(revoked);
      }

      return applyDatabaseSnapshot(current, dbUser, now, userId) as never;
    },
    /** Отдаёт приложению `session.user.id` и `session.user.role`. */
    async session({ session, token }) {
      try {
        if (session?.user) {
          // Токен без подтверждённой БД роли (например, выпущенный до появления
          // полей tenant) не получает привилегий: роль по умолчанию — STUDENT,
          // школа — null. Повышение возможно только после успешной сверки.
          const authoritative = isSessionAuthoritative((token ?? {}) as SessionToken);

          session.user.id = (token?.id as string | undefined) ?? token?.sub ?? "";
          session.user.role = authoritative ? ((token?.role as Role | undefined) || "STUDENT") : "STUDENT";
          session.user.schoolId = authoritative ? ((token?.schoolId as string) || null) : null;
          session.user.classId = authoritative && typeof token?.classId === "string" ? token.classId : null;
          session.user.schoolName = authoritative ? ((token.schoolName as string | null) ?? null) : null;
          session.user.banned = token?.banned === true;

          if (typeof token?.name === "string") session.user.name = token.name;
          if (typeof token?.email === "string") session.user.email = token.email;
          session.user.image = typeof token?.picture === "string" ? token.picture : null;
        }
        return session;
      } catch (err) {
        console.error('[NEXTAUTH_SESSION_ERROR]', err);
        return session;
      }
    },
  },

  debug: process.env.NODE_ENV === "development",
};
