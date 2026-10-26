import type { Role } from "@/types";

/**
 * Правила синхронизации JWT-сессии EduFlow (H-01).
 *
 * Вынесено из `@/lib/auth.ts`, чтобы логику можно было покрыть регрессионными
 * тестами без Prisma и NextAuth: именно здесь закрыт fail-open сценарий, при
 * котором клиентский `update`-payload мог поднять роль до `ADMIN`, если сверка
 * с БД падала.
 *
 * Главное правило: **роль, школа, класс и блокировка приходят только из БД.**
 * Клиентские claims из `session.user` помечены как недоверенные и никогда не
 * копируются в токен.
 */

/**
 * Причины аннулирования сессии (используются и в решении, и в логах).
 */
export type SessionRevocation =
  | "NO_TOKEN"
  | "NO_SUBJECT"
  | "SYNC_FAILED"
  | "USER_DELETED"
  | "ACCOUNT_BANNED"
  | "SESSION_EXPIRED";

/**
 * Сессия признана недействительной.
 *
 * Ошибка пробрасывается из jwt-callback'а наружу: NextAuth логирует
 * `JWT_SESSION_ERROR`, чистит session-cookie, и `getServerSession` возвращает
 * `null`. То есть сессия действительно аннулируется, а не «зависает» с
 * устаревшими правами, как это было при fail-open логике обновления JWT.
 */
export class SessionRevokedError extends Error {
  constructor(readonly reason: SessionRevocation) {
    super(`SESSION_REVOKED:${reason}`);
    this.name = "SessionRevokedError";
  }
}

/** Минимальный набор полей токена, с которым работает модуль. */
export interface SessionToken {
  id?: string | null;
  sub?: string | null;
  role?: Role | string | null;
  schoolId?: string | null;
  classId?: string | null;
  schoolName?: string | null;
  name?: string | null;
  email?: string | null;
  picture?: string | null;
  banned?: boolean;
  /** Unix-ms последней УСПЕШНОЙ сверки с БД. */
  syncedAt?: number;
  /** Версия сессии: растёт при смене пароля/роли (см. `User.sessionVersion`). */
  sessionVersion?: number;
}

/** Срез пользователя, полученный из БД — единственный источник привилегий. */
export interface DatabaseUserSnapshot {
  role: Role | string;
  name: string | null;
  avatar?: string | null;
  isBanned: boolean;
  schoolId: string | null;
  classId: string | null;
  schoolName: string | null;
  /** `null`/`undefined` у старых записей трактуется как 0. */
  sessionVersion?: number | null;
}

/**
 * Поля, которые клиент НИКОГДА не может задать через `useSession().update()`.
 *
 * Список нужен и как документация, и как защита: копирование claims из
 * payload обновления сессии — именно то, что делало возможным H-01.
 */
export const UNTRUSTED_SESSION_FIELDS = [
  "role",
  "schoolId",
  "classId",
  "schoolName",
  "banned",
  "sessionVersion",
] as const;

/**
 * Токен считается полностью синхронизированным: есть роль, есть явный tenant
 * и известен момент сверки. Отсутствие любого из этих полей означает, что
 * привилегии не подтверждены БД.
 */
export function isSessionAuthoritative(token: SessionToken): boolean {
  return (
    Boolean(token.role) &&
    token.schoolId !== undefined &&
    token.classId !== undefined &&
    typeof token.syncedAt === "number"
  );
}

/** Номер версии сессии в токене (старые токены — версия 0). */
export function tokenSessionVersion(token: SessionToken): number {
  return typeof token.sessionVersion === "number" ? token.sessionVersion : 0;
}

/** Номер версии сессии в БД (старые записи — версия 0). */
export function databaseSessionVersion(user: DatabaseUserSnapshot): number {
  return typeof user.sessionVersion === "number" ? user.sessionVersion : 0;
}

/**
 * Нужно ли перечитывать пользователя из БД.
 *
 * `trigger === "update"` означает явный вызов `updateSession()` (например,
 * после повышения до ADMIN): роль надо взять из БД немедленно, не дожидаясь
 * минутного окна. Сам payload при этом игнорируется.
 */
export function shouldSyncSession(
  token: SessionToken,
  options: { trigger?: string | null; now: number; refreshMs: number },
): boolean {
  if (options.trigger === "update") return true;
  if (!isSessionAuthoritative(token)) return true;

  const syncedAt = typeof token.syncedAt === "number" ? token.syncedAt : 0;
  return options.now - syncedAt > options.refreshMs;
}

/**
 * Причины аннулирования сессии. `null` — сессия жива.
 *
 * Проверка выполняется после УСПЕШНОГО чтения из БД: это единственный
 * авторитетный источник. Удалённый, заблокированный аккаунт или устаревшая
 * версия сессии (смена пароля/роли) больше не дают токену прав — fail-closed.
 */
export function sessionRevocationReason(
  user: DatabaseUserSnapshot | null | undefined,
  token: SessionToken,
): "USER_DELETED" | "ACCOUNT_BANNED" | "SESSION_EXPIRED" | null {
  if (!user) return "USER_DELETED";
  if (user.isBanned) return "ACCOUNT_BANNED";
  if (databaseSessionVersion(user) !== tokenSessionVersion(token)) return "SESSION_EXPIRED";
  return null;
}

/**
 * Переносит в токен ТОЛЬКО данные из БД и ставит свежий `syncedAt`.
 *
 * Возвращает новый объект: исходный токен не мутируется, чтобы при ошибке БД
 * можно было безопасно отдать прежнее значение.
 */
export function applyDatabaseSnapshot(
  token: SessionToken,
  user: DatabaseUserSnapshot,
  now: number,
  userId?: string | null,
): SessionToken {
  return {
    ...token,
    ...(userId ? { id: userId } : {}),
    role: user.role as Role,
    schoolId: user.schoolId,
    classId: user.classId,
    schoolName: user.schoolName,
    name: user.name,
    picture: user.avatar ?? null,
    banned: user.isBanned,
    sessionVersion: databaseSessionVersion(user),
    syncedAt: now,
  };
}

/**
 * Что делать с токеном, если БД недоступна.
 *
 * Fail-closed: если привилегии токена ещё не подтверждены БД
 * (`isSessionAuthoritative() === false`), сессию аннулируем — иначе при ошибке
 * БД в момент `update` роли клиентские claims остались бы в силе.
 *
 * Уже подтверждённый токен живёт до `graceMs` (по умолчанию сутки) — это
 * компромисс с доступностью: кратковременная недоступность БД не выкидывает
 * всех пользователей. `syncedAt` при этом НЕ обновляется, поэтому следующий
 * запрос снова попытается свериться.
 */
export function keepSessionOnDatabaseError(
  token: SessionToken,
  options: { now: number; graceMs: number },
): boolean {
  if (!isSessionAuthoritative(token)) return false;

  const syncedAt = typeof token.syncedAt === "number" ? token.syncedAt : 0;
  return options.now - syncedAt <= options.graceMs;
}
