import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { normalizeInviteToken, resolveInviteRole, rolesForInvite, type InviteRole } from "@/lib/invite-rules";
import {
  gradeFromClassName,
  findSchoolByCode,
  getSchoolInviteSummary,
  getSchoolPolicy,
  normalizeSchoolCode,
  resolveSingleClassId,
} from "@/lib/schools";
import { SINGLE_CLASS_NAME, isSingleClassSchool } from "@/lib/school-config";
import { validateRegisterInput, type RegisterResponse } from "@/lib/validation";
import type { Role } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Роль из запроса (строка) → верхний регистр, иначе — STUDENT. */
function requestedRoleOf(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim().toUpperCase() : "STUDENT";
}

/**
 * POST /api/auth/register — создание аккаунта ученика, учителя или администратора.
 *
 * Шаги: валидация входных данных → проверка уникальности email →
 * bcrypt-хеширование пароля → запись пользователя в PostgreSQL.
 *
 * Трёхуровневая система доступа (роль выбирается по секретной ссылке `invite`):
 *  - без `invite` — ВСЕГДА только `STUDENT` (публичная регистрация);
 *  - `invite` = `teacherInviteToken` школы — можно роль `TEACHER`;
 *  - `invite` = `adminInviteToken` школы — можно роль `ADMIN`.
 * Токен проверяется против школы с указанным `schoolCode`: чужой или
 * подделанный токен роли не даёт.
 */
export async function POST(request: Request): Promise<NextResponse<RegisterResponse>> {
  /* 1. Тело запроса ------------------------------------------------------ */
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Некорректный JSON в теле запроса", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  if (typeof payload !== "object" || payload === null) {
    return NextResponse.json(
      { ok: false, error: "Ожидается JSON-объект с данными регистрации", code: "VALIDATION_ERROR" },
      { status: 422 },
    );
  }

  const raw = payload as Record<string, unknown>;

  /* 2. Школа и секретная ссылка-приглашение ------------------------------ */
  if (!normalizeSchoolCode(raw.schoolCode)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Проверьте правильность заполнения полей",
        code: "VALIDATION_ERROR",
        fields: { schoolCode: "Введите корректный код школы" },
      },
      { status: 422 },
    );
  }

  const school = await findSchoolByCode(raw.schoolCode);
  if (!school) {
    return NextResponse.json(
      {
        ok: false,
        error: "Школа с таким кодом не найдена",
        code: "SCHOOL_NOT_FOUND",
        fields: { schoolCode: "Проверьте код школы" },
      },
      { status: 422 },
    );
  }

  const inviteFromQuery = new URL(request.url).searchParams.get("invite");
  const inviteToken = normalizeInviteToken(raw.invite ?? inviteFromQuery);
  const schoolInvites = await getSchoolInviteSummary(school.id);
  const inviteRole: InviteRole | null = resolveInviteRole(schoolInvites, inviteToken);

  /* 3. Роль: без валидного приглашения — всегда STUDENT ------------------ */
  const allowedRoles = rolesForInvite(inviteRole);
  const requestedRole = requestedRoleOf(raw.role);
  const effectiveRole: Role = (allowedRoles as readonly string[]).includes(requestedRole)
    ? (requestedRole as Role)
    : "STUDENT";
  raw.role = effectiveRole;

  /* 4. Политика школы и валидация ----------------------------------------- */
  /*
    Гибкая школа (`strictClassIsolation === false`) — ученик вправе
    зарегистрироваться БЕЗ класса: `users.classId` в схеме опциональна, а
    доступ к урокам такой школы не привязан к классу (`resolveMeetingAccess`).
    Строгая школа по-прежнему требует класс.
  */
  const policy = await getSchoolPolicy(school.id);
  const strictClassIsolation = policy?.strictClassIsolation ?? false;

  const validation = validateRegisterInput(raw, { allowedRoles, classIdOptional: !strictClassIsolation });
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, error: validation.error, code: "VALIDATION_ERROR", fields: validation.fields },
      { status: 422 },
    );
  }

  const { name, email, password, role, classId: requestedClassId } = validation.data;

  /**
   * Единственная форма email для проверок и для записи в БД.
   *
   * `users.email` — регистрозависимый уникальный индекс PostgreSQL, поэтому
   * `Ivan@School.RU ` и `ivan@school.ru` без нормализации оказались бы двумя
   * разными аккаунтами: пользователь создавал бы «двойника» и потом не мог
   * войти (вход ищет пользователя по нормализованному email, см. `@/lib/auth`).
   */
  const cleanEmail = email.toLowerCase().trim();

  try {
    /*
      Одноклассная школа («Школа Душа»): класс не выбирается — ученик сразу
      попадает в единственный класс школы, даже если форма не прислала
      `classId`. Так регистрация остаётся «в один клик»: код школы → ФИО →
      email → пароль.
    */
    const classId =
      role === "STUDENT" && !requestedClassId ? await resolveSingleClassId(school.id) : requestedClassId;

    const schoolClass = role === "STUDENT" && classId
      ? await prisma.class.findFirst({
          where: { id: classId, schoolId: school.id },
          select: { id: true, name: true },
        })
      : null;
    // Указанный класс обязан принадлежать выбранной школе.
    if (role === "STUDENT" && classId && !schoolClass) {
      return NextResponse.json(
        {
          ok: false,
          error: "Выберите класс из выбранной школы",
          code: "INVALID_CLASS",
          fields: { classId: "Класс не относится к этой школе" },
        },
        { status: 422 },
      );
    }
    // Без класса можно учиться только в гибкой школе (fail closed).
    if (role === "STUDENT" && !schoolClass && strictClassIsolation) {
      return NextResponse.json(
        {
          ok: false,
          error: "Выберите класс из выбранной школы",
          code: "INVALID_CLASS",
          fields: { classId: "Класс не относится к этой школе" },
        },
        { status: 422 },
      );
    }

    const grade = schoolClass ? gradeFromClassName(schoolClass.name) : null;
    // У единственного класса школы («Общий») нет номера параллели — это не
    // ошибка: `users.grade` остаётся null, доступ к урокам даёт сам класс.
    const gradeMayBeMissing =
      isSingleClassSchool(school.code) || schoolClass?.name === SINGLE_CLASS_NAME;
    if (role === "STUDENT" && schoolClass && !grade && !gradeMayBeMissing) {
      return NextResponse.json(
        {
          ok: false,
          error: "У выбранного класса некорректное название",
          code: "INVALID_CLASS",
          fields: { classId: "Обратитесь к администратору школы" },
        },
        { status: 422 },
      );
    }

    /* 5. Уникальность email --------------------------------------------- */
    // Ищем без учёта регистра: в базе могли остаться аккаунты, созданные до
    // нормализации («Ivan@School.ru»), и заводить им двойника нельзя.
    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: cleanEmail, mode: "insensitive" } },
      select: { id: true },
    });

    if (existingUser) {
      return NextResponse.json(
        {
          ok: false,
          error: "Пользователь с таким email уже зарегистрирован",
          code: "EMAIL_TAKEN",
          fields: { email: "Этот email уже занят" },
        },
        { status: 409 },
      );
    }

    /* 6. Хеширование пароля и создание пользователя --------------------- */
    // bcryptjs, 10 раундов соли: `hashPassword` → `bcrypt.hash(password, BCRYPT_SALT_ROUNDS)`.
    // Открытый пароль нигде не сохраняется и наружу не возвращается.
    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name,
        email: cleanEmail,
        password: passwordHash,
        role,
        schoolId: school.id,
        classId: schoolClass?.id ?? null,
        grade,
      },
      select: { id: true, name: true, email: true, role: true, schoolId: true, classId: true, createdAt: true },
    });

    return NextResponse.json(
      { ok: true, data: { user: { ...user, createdAt: user.createdAt.toISOString() } } },
      { status: 201 },
    );
  } catch (error) {
    // Гонка двух одновременных запросов с одним email: побеждает уникальный индекс.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        {
          ok: false,
          error: "Пользователь с таким email уже зарегистрирован",
          code: "EMAIL_TAKEN",
          fields: { email: "Этот email уже занят" },
        },
        { status: 409 },
      );
    }

    console.error("[register] Не удалось создать пользователя:", error);

    return NextResponse.json(
      { ok: false, error: "Не удалось создать аккаунт. Попробуйте позже.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}

/** GET /api/auth/register — подсказка для ручных проверок. */
export function GET(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Используйте метод POST", code: "METHOD_NOT_ALLOWED" },
    { status: 405 },
  );
}
