import type { ClassGrade, Prisma, Role as PrismaRole } from "@prisma/client";

import { conflict, notFound } from "@/lib/api";
import { hashPassword } from "@/lib/password";
import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@/lib/prisma";
import { schoolScope } from "@/lib/admin-tenant";
import { GRADE_LABELS, isGradeCode, type GradeCode } from "@/lib/schedule-rules";
import {
  EMAIL_REGEX,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  getPasswordIssues,
  normalizeEmail,
} from "@/lib/validation";
import type { Role } from "@/types";

/**
 * Управление пользователями из админ-панели: поиск, фильтры, создание,
 * смена роли/класса, сброс пароля и блокировка.
 *
 * Права проверяются ДО вызова этих функций (`admin-permissions.ts` +
 * `requireCapability` + `requireAdminViewer` в API-роутах). Каждый доступ к
 * ресурсу дополнительно ограничивает школу явным предикатом Prisma.
 */

export const USERS_PAGE_SIZE = 25;
export const USERS_PAGE_SIZE_MAX = 100;

/** Открытая запись посещаемости старше этого времени считается «зависшей». */
const ONLINE_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

const ROLES: readonly Role[] = ["ADMIN", "TEACHER", "STUDENT"];

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  grade: GradeCode | null;
  isBanned: boolean;
  createdAt: string;
  updatedAt: string;
  /** Открытая запись посещаемости: пользователь сейчас в уроке. */
  isOnline: boolean;
  /** Включён ли второй фактор — иначе админ не поймёт, зачем жать «сбросить». */
  twoFactorEnabled: boolean;
}

export interface ListUsersOptions {
  search?: string;
  role?: Role;
  grade?: GradeCode;
  bannedOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ListUsersResult {
  items: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function normalizeSearchTerm(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

export function parseRole(value: unknown): Role | undefined {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value) ? (value as Role) : undefined;
}

export function parseGrade(value: unknown): GradeCode | undefined {
  return isGradeCode(value) ? value : undefined;
}

/** Список пользователей с поиском по имени/email и фильтрами по роли и классу. */
export async function listUsersForAdmin(schoolId: string, options: ListUsersOptions = {}): Promise<ListUsersResult> {
  const tenant = schoolScope(schoolId);
  const pageSize = Math.min(Math.max(options.pageSize ?? USERS_PAGE_SIZE, 1), USERS_PAGE_SIZE_MAX);
  const search = normalizeSearchTerm(options.search);
  const requestedPage = Math.max(options.page ?? 1, 1);

  const where: Prisma.UserWhereInput = {
    ...tenant,
    ...(options.role ? { role: options.role as PrismaRole } : {}),
    ...(options.grade ? { grade: options.grade as ClassGrade } : {}),
    ...(options.bannedOnly ? { isBanned: true } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const total = await prisma.user.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);

  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      grade: true,
      isBanned: true,
      twoFactorEnabledAt: true,
      createdAt: true,
      updatedAt: true,
      attendance: {
        where: { leftAt: null, joinedAt: { gte: new Date(Date.now() - ONLINE_STALE_AFTER_MS) }, meeting: { is: tenant } },
        select: { id: true },
        take: 1,
      },
    },
  });

  return {
    total,
    page,
    pageSize,
    pageCount,
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role as Role,
      grade: (row.grade as GradeCode | null) ?? null,
      isBanned: row.isBanned,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      isOnline: row.attendance.length > 0,
      twoFactorEnabled: Boolean(row.twoFactorEnabledAt),
    })),
  };
}

export async function getUserForAdmin(id: string, schoolId: string): Promise<AdminUserRow | null> {
  const row = await prisma.user.findFirst({
    where: { id, ...schoolScope(schoolId) },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      grade: true,
      isBanned: true,
      twoFactorEnabledAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as Role,
    grade: (row.grade as GradeCode | null) ?? null,
    isBanned: row.isBanned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isOnline: false,
    twoFactorEnabled: Boolean(row.twoFactorEnabledAt),
  };
}

/* -------------------------------------------------------------------------- */
/* Валидация                                                                   */
/* -------------------------------------------------------------------------- */

export interface AdminUserCreateInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  grade: GradeCode | null;
}

export interface AdminUserUpdateInput {
  name?: string;
  role?: Role;
  grade?: GradeCode | null;
  password?: string;
  isBanned?: boolean;
}

export type AdminUserValidation<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fields: Record<string, string> };

function readName(raw: unknown, fields: Record<string, string>): string | undefined {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) {
    fields.name = "Укажите имя";
    return undefined;
  }
  if (name.length < NAME_MIN_LENGTH) {
    fields.name = `Минимум ${NAME_MIN_LENGTH} символа`;
    return undefined;
  }
  if (name.length > NAME_MAX_LENGTH) {
    fields.name = `Максимум ${NAME_MAX_LENGTH} символов`;
    return undefined;
  }
  return name;
}

function readPassword(raw: unknown, fields: Record<string, string>): string | undefined {
  const password = typeof raw === "string" ? raw : "";
  if (!password) {
    fields.password = "Укажите пароль";
    return undefined;
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    fields.password = `Минимум ${PASSWORD_MIN_LENGTH} символов`;
    return undefined;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    fields.password = `Максимум ${PASSWORD_MAX_LENGTH} символов`;
    return undefined;
  }
  const issues = getPasswordIssues(password);
  if (issues.length > 0) {
    fields.password = `Пароль должен содержать ${issues.join(" и ")}`;
    return undefined;
  }
  return password;
}

/** Валидация создания пользователя администратором. */
export function validateUserCreate(input: unknown): AdminUserValidation<AdminUserCreateInput> {
  const fields: Record<string, string> = {};

  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Ожидается JSON-объект пользователя", fields: {} };
  }

  const raw = input as Record<string, unknown>;
  const name = readName(raw.name, fields);

  const email = typeof raw.email === "string" ? normalizeEmail(raw.email) : "";
  if (!email) fields.email = "Укажите email";
  else if (!EMAIL_REGEX.test(email)) fields.email = "Некорректный email";

  const password = readPassword(raw.password, fields);

  const role = parseRole(raw.role) ?? "STUDENT";

  let grade: GradeCode | null = null;
  if (role === "STUDENT") {
    if (raw.grade !== undefined && raw.grade !== null && raw.grade !== "") {
      if (isGradeCode(raw.grade)) grade = raw.grade;
      else fields.grade = "Класс может быть с 5 по 11";
    }
  } else if (raw.grade !== undefined && raw.grade !== null && raw.grade !== "") {
    fields.grade = "Класс назначается только ученикам";
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, error: "Проверьте данные пользователя", fields };
  }

  return {
    ok: true,
    data: { name: name ?? "", email, password: password ?? "", role, grade },
  };
}

/** Валидация частичного обновления (роль, класс, имя, пароль, блокировка). */
export function validateUserUpdate(input: unknown): AdminUserValidation<AdminUserUpdateInput> {
  const fields: Record<string, string> = {};

  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Ожидается JSON-объект изменений", fields: {} };
  }

  const raw = input as Record<string, unknown>;
  const patch: AdminUserUpdateInput = {};

  if (raw.name !== undefined) {
    const name = readName(raw.name, fields);
    if (name) patch.name = name;
  }

  if (raw.role !== undefined) {
    const role = parseRole(raw.role);
    if (!role) fields.role = "Роль может быть ADMIN, TEACHER или STUDENT";
    else patch.role = role;
  }

  if (raw.grade !== undefined) {
    if (raw.grade === null || raw.grade === "" || raw.grade === "NONE") patch.grade = null;
    else if (isGradeCode(raw.grade)) patch.grade = raw.grade;
    else fields.grade = "Класс может быть с 5 по 11";
  }

  if (raw.password !== undefined) {
    const password = readPassword(raw.password, fields);
    if (password) patch.password = password;
  }

  if (raw.isBanned !== undefined) {
    if (typeof raw.isBanned !== "boolean") fields.isBanned = "Некорректное значение";
    else patch.isBanned = raw.isBanned;
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, error: "Проверьте данные пользователя", fields };
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Нет изменений для сохранения", fields: {} };
  }

  return { ok: true, data: patch };
}

/* -------------------------------------------------------------------------- */
/* Изменения                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Создаёт пользователя из админ-панели (в том числе с ролью ADMIN).
 *
 * `schoolId` приходит ТОЛЬКО от оператора (сессия админа, `viewer.schoolId`):
 * из тела запроса школа не принимается, поэтому новый аккаунт всегда попадает
 * в школу администратора, а не «в основную по умолчанию» (исправление M-02).
 */
export async function createUserAsAdmin(
  input: AdminUserCreateInput,
  schoolId: string,
): Promise<AdminUserRow> {
  const tenant = schoolScope(schoolId);
  // Email is globally unique for authentication; this check exposes no user fields.
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw conflict("Пользователь с таким email уже существует", { email: "Email занят" });
  }

  const created = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      password: await hashPassword(input.password),
      role: input.role as PrismaRole,
      grade: input.role === "STUDENT" ? ((input.grade ?? null) as ClassGrade | null) : null,
      ...tenant,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      grade: true,
      isBanned: true,
      twoFactorEnabledAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    id: created.id,
    name: created.name,
    email: created.email,
    role: created.role as Role,
    grade: (created.grade as GradeCode | null) ?? null,
    isBanned: created.isBanned,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    isOnline: false,
    twoFactorEnabled: Boolean(created.twoFactorEnabledAt),
  };
}

export interface UpdateUserResult {
  user: AdminUserRow;
  /** Что именно изменилось — уходит в журнал аудита. */
  changes: Record<string, unknown>;
  /** Изменение отзывает действующие JWT и сокет-сессии пользователя. */
  sessionsRevoked: boolean;
}

/**
 * Применяет изменения к пользователю.
 *
 * Пароль никогда не возвращается и не попадает в журнал: в `changes` пишем
 * только факт сброса.
 */
export async function updateUserAsAdmin(targetId: string, schoolId: string, patch: AdminUserUpdateInput): Promise<UpdateUserResult> {
  const tenant = schoolScope(schoolId);
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findFirst({
      where: { id: targetId, ...tenant },
      select: { id: true, role: true, grade: true, name: true, isBanned: true },
    });
    if (!target) throw notFound("Пользователь не найден");

    const nextRole: Role = patch.role ?? (target.role as Role);
    // Класс есть только у учеников: при смене роли сбрасываем его.
    const nextGrade: GradeCode | null =
      nextRole === "STUDENT"
        ? patch.grade !== undefined
          ? patch.grade
          : ((target.grade as GradeCode | null) ?? null)
        : null;

    const gradeChanged = nextGrade !== (target.grade ?? null);

    /**
     * Смена пароля, роли, класса или блокировка отзывают ВСЕ сессии пользователя
     * (H-06): `sessionVersion` растёт, и jwt-callback аннулирует каждый токен,
     * выпущенный с прежней версией. Без этого украденная сессия жила бы до
     * истечения срока JWT, несмотря на смену пароля администратором, а переведённый
     * в другой класс ученик сохранял бы доступ к урокам прежнего класса до
     * переподключения (сокет помнит класс с момента handshake).
     */
    const revokesSessions =
      patch.password !== undefined ||
      (patch.role !== undefined && patch.role !== target.role) ||
      gradeChanged ||
      (patch.isBanned !== undefined && patch.isBanned !== target.isBanned);

    const data: Prisma.UserUpdateManyMutationInput = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.role !== undefined ? { role: patch.role as PrismaRole } : {}),
      ...(patch.grade !== undefined || nextGrade !== (target.grade ?? null)
        ? { grade: nextGrade as ClassGrade | null }
        : {}),
      ...(patch.password !== undefined ? { password: await hashPassword(patch.password) } : {}),
      ...(patch.isBanned !== undefined ? { isBanned: patch.isBanned } : {}),
      ...(revokesSessions ? { sessionVersion: { increment: 1 } } : {}),
    };

    // Compound tenant predicate makes the write safe even if the target moved tenants.
    const result = await tx.user.updateMany({ where: { id: targetId, ...tenant }, data });
    if (result.count !== 1) throw notFound("Пользователь не найден");
    const updated = await tx.user.findFirstOrThrow({
      where: { id: targetId, ...tenant },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        grade: true,
        isBanned: true,
        sessionVersion: true,
        twoFactorEnabledAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const changes: Record<string, unknown> = {};
    if (patch.role !== undefined && patch.role !== target.role) {
      changes.role = { from: target.role, to: patch.role };
    }
    if (gradeChanged) {
      changes.grade = {
        from: target.grade ? GRADE_LABELS[target.grade as GradeCode] : "не назначен",
        to: nextGrade ? GRADE_LABELS[nextGrade] : "не назначен",
      };
    }
    if (patch.name !== undefined && patch.name !== target.name) changes.name = patch.name;
    if (patch.password !== undefined) changes.passwordReset = true;
    if (patch.isBanned !== undefined && patch.isBanned !== target.isBanned) {
      changes.banned = patch.isBanned;
    }
    if (revokesSessions) changes.sessionsRevoked = true;

    return {
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role as Role,
        grade: (updated.grade as GradeCode | null) ?? null,
        isBanned: updated.isBanned,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        isOnline: false,
        twoFactorEnabled: Boolean(updated.twoFactorEnabledAt),
      },
      changes,
      /** Сессии отозваны — вызывающий маршрут рвёт живые сокеты. */
      sessionsRevoked: revokesSessions,
    };
  }, INTERACTIVE_TRANSACTION_OPTIONS);
}
