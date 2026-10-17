import { randomUUID } from "node:crypto";

import { configuredAdminInviteToken } from "@/lib/school-config";

/**
 * Выпуск токенов-приглашений школы на стороне приложения.
 *
 * Колонки `schools.teacherInviteToken` и `schools.adminInviteToken` — nullable
 * (`String? @unique` в `prisma/schema.prisma`). Это осознанно: `@default(uuid())`
 * Prisma вычисляет в клиенте, а не в PostgreSQL, поэтому обязательную колонку без
 * DB-level default нельзя добавить в непустую таблицу — `prisma db push` на Render
 * падал с «The required column `adminInviteToken` was added to the `schools` table».
 *
 * Теперь схему можно накатывать на живую базу, а значения токенов создаёт
 * приложение: при создании школы и ленивым досозданием у существующих строк
 * (`backfillSchoolInviteTokens` / `getSchoolInviteSummary` в `@/lib/schools`).
 *
 * Модуль серверный (node:crypto) и не зависит от Prisma — его легко тестировать.
 */

/** Данные токенов приглашения: поля отсутствуют, если токен уже заполнен. */
export interface InviteTokenData {
  teacherInviteToken?: string;
  adminInviteToken?: string;
}

/** Минимальный срез строки школы, нужный для выпуска токенов. */
export interface SchoolTokenRow {
  code: string;
  teacherInviteToken?: string | null;
  adminInviteToken?: string | null;
}

/** Новый случайный токен приглашения (UUID v4). */
export function generateInviteToken(): string {
  return randomUUID();
}

/**
 * Admin-токен школы: у настроенных школ он детерминированный (пресет из
 * `school-config.ts`, чтобы админ-ссылка не менялась между деплоями), у остальных —
 * случайный.
 */
export function adminInviteTokenFor(code: string): string {
  return configuredAdminInviteToken(code) ?? generateInviteToken();
}

/** Оба токена для НОВОЙ школы (create/upsert-create). */
export function inviteTokensForNewSchool(code: string): Required<InviteTokenData> {
  return {
    teacherInviteToken: generateInviteToken(),
    adminInviteToken: adminInviteTokenFor(code),
  };
}

/**
 * Разрешён ли принудительный возврат admin-токенов к предустановленным значениям.
 *
 * По умолчанию ВЫКЛЮЧЕН (исправление C-01): возврат к литералу из репозитория
 * делал бы бессмысленной ротацию секрета в БД и позволял любому, кто читает
 * публичный код, вернуть известный admin-токен. Включается оператором на один
 * запуск через `SCHOOLMEET_RESTORE_CONFIGURED_INVITE_TOKENS=true`.
 */
export function configuredInviteTokensRestored(): boolean {
  return (process.env.SCHOOLMEET_RESTORE_CONFIGURED_INVITE_TOKENS ?? "").trim().toLowerCase() === "true";
}

/**
 * Токены для плановой инициализации: startup provisioning и ПУБЛИЧНАЯ проверка
 * кода школы (`/api/schools/check`).
 *
 * Здесь досоздаются только ОТСУТСТВУЮЩИЕ токены: уже сохранённый в БД
 * admin-токен не перетирается. Ранее публичный endpoint возвращал настроенным
 * школам известный пресет — это и было критической находкой C-01.
 */
export function provisioningInviteData(school: SchoolTokenRow): InviteTokenData {
  const data = missingInviteTokens(school);
  if (!configuredInviteTokensRestored()) return data;
  return { ...data, ...configuredSchoolInviteData(school) };
}

/**
 * Каких токенов не хватает в существующей строке школы.
 *
 * Пустой объект — оба токена на месте, запись в БД не нужна. Пустая строка
 * считается отсутствующим токеном: она не может быть валидной ссылкой-приглашением.
 */
export function missingInviteTokens(school: SchoolTokenRow): InviteTokenData {
  const data: InviteTokenData = {};
  if (!school.teacherInviteToken) data.teacherInviteToken = generateInviteToken();
  if (!school.adminInviteToken) data.adminInviteToken = adminInviteTokenFor(school.code);
  return data;
}

/**
 * Токены для записи в СУЩЕСТВУЮЩУЮ школу: досоздаёт отсутствующие значения и
 * возвращает admin-токен настроенных школ к детерминированному пресету
 * (админ-ссылка школы не должна меняться между деплоями).
 *
 * ⚠️ Использовать ТОЛЬКО в осознанной операции оператора (см.
 * `provisioningInviteData` и `configuredInviteTokensRestored`): автоматические
 * пути инициализации не должны откатывать ротированный в БД секрет.
 */
export function configuredSchoolInviteData(school: SchoolTokenRow): InviteTokenData {
  const data = missingInviteTokens(school);
  const preset = configuredAdminInviteToken(school.code);
  if (preset && preset !== school.adminInviteToken) data.adminInviteToken = preset;
  return data;
}

/** Есть ли что записывать в БД (незаполненный токен или сброс пресета). */
export function hasInviteTokenChanges(data: InviteTokenData): boolean {
  return Boolean(data.teacherInviteToken || data.adminInviteToken);
}
