import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { gradeFromClassName, findSchoolByCode } from "@/lib/schools";
import { validateRegisterInput, type RegisterResponse } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/register — создание аккаунта учителя или ученика.
 *
 * Шаги: валидация входных данных → проверка уникальности email →
 * bcrypt-хеширование пароля → запись пользователя в PostgreSQL.
 * Роль ADMIN через этот эндпоинт выдать нельзя (см. `PUBLIC_ROLES`).
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

  /* 2. Валидация --------------------------------------------------------- */
  const validation = validateRegisterInput(payload);
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, error: validation.error, code: "VALIDATION_ERROR", fields: validation.fields },
      { status: 422 },
    );
  }

  const { name, email, password, role, schoolCode, classId } = validation.data;

  try {
    const school = await findSchoolByCode(schoolCode);
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

    const schoolClass = role === "STUDENT" && classId
      ? await prisma.class.findFirst({
          where: { id: classId, schoolId: school.id },
          select: { id: true, name: true },
        })
      : null;
    if (role === "STUDENT" && !schoolClass) {
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
    if (role === "STUDENT" && !grade) {
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

    /* 3. Уникальность email --------------------------------------------- */
    const existingUser = await prisma.user.findUnique({
      where: { email },
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

    /* 4. Хеширование пароля и создание пользователя --------------------- */
    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name,
        email,
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
