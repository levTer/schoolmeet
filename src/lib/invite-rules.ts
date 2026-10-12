import type { Role } from "@/types";

/**
 * Правила секретных ссылок-приглашений (`invite`-токены школы).
 *
 * У каждой школы два токена: `teacherInviteToken` (регистрация учителей) и
 * `adminInviteToken` (регистрация или повышение до ADMIN). Модуль чистый
 * (без БД и Node API) — им пользуются и сервер, и клиент, и тесты.
 *
 * Публичная регистрация (без валидного токена) ВСЕГДА даёт только роль STUDENT.
 */

/** Роль, которую выдаёт ссылка-приглашение (уровень доступа ссылки). */
export type InviteRole = "TEACHER" | "ADMIN";

/** Минимум полей школы, нужный для проверки токенов. */
export interface InviteTokenPair {
  teacherInviteToken?: string | null;
  adminInviteToken?: string | null;
}

/** Нормализует токен приглашения: строка без пробелов по краям (иначе — ""). */
export function normalizeInviteToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Сравнение токенов за время, не зависящее от места первого расхождения
 * (секреты нельзя подбирать по таймингу). Разная длина — сразу «не совпадают».
 */
export function tokensMatch(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Определяет уровень приглашения по токенам школы.
 *
 * При совпадении обоих токенов (теоретически возможном) побеждает ADMIN —
 * более привилегированная роль. Незнакомый или пустой токен → `null`
 * (публичная регистрация, только STUDENT).
 */
export function resolveInviteRole(school: InviteTokenPair | null | undefined, invite: unknown): InviteRole | null {
  const token = normalizeInviteToken(invite);
  if (!school || !token) return null;

  const adminToken = typeof school.adminInviteToken === "string" ? school.adminInviteToken : "";
  const teacherToken = typeof school.teacherInviteToken === "string" ? school.teacherInviteToken : "";

  if (adminToken && tokensMatch(token, adminToken)) return "ADMIN";
  if (teacherToken && tokensMatch(token, teacherToken)) return "TEACHER";
  return null;
}

/** Роли, доступные при публичной регистрации (без приглашения). */
export const PUBLIC_REGISTER_ROLES: readonly Role[] = ["STUDENT"];

const INVITE_ROLE_MATRIX: Record<InviteRole, readonly Role[]> = {
  TEACHER: ["STUDENT", "TEACHER"],
  ADMIN: ["STUDENT", "TEACHER", "ADMIN"],
};

/** Роли, которые можно получить по ссылке данного уровня. */
export function rolesForInvite(inviteRole: InviteRole | null): readonly Role[] {
  return inviteRole ? INVITE_ROLE_MATRIX[inviteRole] : PUBLIC_REGISTER_ROLES;
}

/** Разрешена ли выдача роли по данной ссылке (без ссылки — только STUDENT). */
export function inviteAllowsRole(inviteRole: InviteRole | null, role: Role): boolean {
  return rolesForInvite(inviteRole).includes(role);
}
