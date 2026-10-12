import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { DEFAULT_CLASS_NAMES } from "@/lib/school-config";
import { normalizeSchoolCode } from "@/lib/school-rules";
import { listClassesForSchool } from "@/lib/schools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Коды, которые проверка школы создаёт сама, если их ещё нет в базе.
 * Имена используются только при автосоздании; существующую школу не переименовываем.
 */
const ALLOWED_SCHOOLS = [
  { name: "Синлицей №26", code: "Sinlycem26" },
  { name: "Личный Кабинет 1", code: "Fulhouseteem26" },
  { name: "Личный Кабинет 2", code: "Anna.Terentieva77" },
] as const;

type AllowedSchool = (typeof ALLOWED_SCHOOLS)[number];

const SCHOOL_SELECT = { id: true, name: true, code: true } as const;

function serverError(): NextResponse {
  return NextResponse.json({ valid: false, error: "Server Error" }, { status: 500 });
}

function matchAllowedSchool(code: string): AllowedSchool | null {
  const needle = code.trim().toLowerCase();
  return ALLOWED_SCHOOLS.find((school) => school.code.toLowerCase() === needle) ?? null;
}

/** Код из query (`?code=`) или JSON-тела (`code` / `schoolCode`). Пробелы по краям снимает вызывающий `.trim()`. */
async function readRawCode(request: Request): Promise<string> {
  const fromQuery = new URL(request.url).searchParams.get("code");
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery;

  if (request.method !== "POST" && request.method !== "PUT") {
    return typeof fromQuery === "string" ? fromQuery : "";
  }

  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      const candidate = record.code ?? record.schoolCode;
      if (typeof candidate === "string") return candidate;
    }
  } catch {
    // Некорректный JSON — это ошибка ввода, а не падение сервера.
  }

  return typeof fromQuery === "string" ? fromQuery : "";
}

async function findOrCreateSchool(code: string) {
  const allowed = matchAllowedSchool(code);
  const lookup = allowed?.code ?? code;

  let school = await prisma.school.findFirst({
    where: { code: { equals: lookup, mode: "insensitive" } },
    select: SCHOOL_SELECT,
  });

  if (!school && allowed) {
    try {
      school = await prisma.school.create({
        data: { name: allowed.name, code: allowed.code },
        select: SCHOOL_SELECT,
      });
    } catch (error) {
      // Параллельный запрос уже создал школу с этим уникальным кодом.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      school = await prisma.school.findFirst({
        where: { code: { equals: allowed.code, mode: "insensitive" } },
        select: SCHOOL_SELECT,
      });
      if (!school) throw error;
    }
  }

  // Для разрешённого кода всегда досеиваем стандартный набор 5-А … 11-Б.
  if (school && allowed) {
    const schoolId = school.id;
    await prisma.class.createMany({
      data: DEFAULT_CLASS_NAMES.map((name) => ({ schoolId, name })),
      skipDuplicates: true,
    });
  }

  return school;
}

async function checkSchool(request: Request): Promise<NextResponse> {
  const code = (await readRawCode(request)).trim();
  if (!normalizeSchoolCode(code)) {
    return NextResponse.json(
      {
        valid: false,
        ok: false,
        error: "Введите корректный код школы",
        code: "INVALID_SCHOOL_CODE",
        fields: {
          schoolCode: "Код должен содержать от 3 до 32 латинских букв, цифр, точки, дефиса или подчёркивания",
        },
      },
      { status: 422 },
    );
  }

  const school = await findOrCreateSchool(code);
  if (!school) {
    return NextResponse.json(
      {
        valid: false,
        ok: false,
        error: "Школа с таким кодом не найдена",
        code: "SCHOOL_NOT_FOUND",
        fields: { schoolCode: "Проверьте код школы" },
      },
      { status: 404 },
    );
  }

  const classes = await listClassesForSchool(school.id);
  const schoolView = { id: school.id, name: school.name, code: school.code };

  return NextResponse.json({
    valid: true,
    ok: true,
    school: schoolView,
    classes,
    data: { school: schoolView, classes },
  });
}

/** Публичная проверка кода школы при регистрации. Не требует сессии. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    return await checkSchool(request);
  } catch (error) {
    console.error("[api/schools/check GET] Непредвиденная ошибка:", error);
    return serverError();
  }
}

/** Тот же контракт, если код пришёл в JSON-теле. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    return await checkSchool(request);
  } catch (error) {
    console.error("[api/schools/check POST] Непредвиденная ошибка:", error);
    return serverError();
  }
}
