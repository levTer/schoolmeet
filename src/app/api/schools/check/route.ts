import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { DEFAULT_CLASS_NAMES, configuredAdminInviteToken } from "@/lib/school-config";
import { normalizeInviteToken, resolveInviteRole, type InviteRole } from "@/lib/invite-rules";
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

const SCHOOL_SELECT = { id: true, name: true, code: true, teacherInviteToken: true, adminInviteToken: true } as const;

function serverError(): NextResponse {
  return NextResponse.json({ valid: false, error: "Server Error" }, { status: 500 });
}

function matchAllowedSchool(code: string): AllowedSchool | null {
  const needle = code.trim().toLowerCase();
  return ALLOWED_SCHOOLS.find((school) => school.code.toLowerCase() === needle) ?? null;
}

/** Предустановленный admin-токен для наших школ (см. `school-config.ts`). */
function adminInviteData(code: string): { adminInviteToken?: string } {
  const preset = configuredAdminInviteToken(code);
  return preset ? { adminInviteToken: preset } : {};
}

/** Код и токен приглашения из query (`?code=`, `?invite=`) или JSON-тела. Тело читается один раз. */
async function readCodeAndInvite(request: Request): Promise<{ code: string; invite: string }> {
  const params = new URL(request.url).searchParams;
  let code = params.get("code") ?? "";
  let invite = params.get("invite") ?? "";

  if (request.method === "POST" || request.method === "PUT") {
    try {
      const body = (await request.json()) as unknown;
      if (body && typeof body === "object") {
        const record = body as Record<string, unknown>;
        const rawCode = record.code ?? record.schoolCode;
        const rawInvite = record.invite;
        if (typeof rawCode === "string") code = rawCode;
        if (typeof rawInvite === "string") invite = rawInvite;
      }
    } catch {
      // Некорректный JSON — это ошибка ввода, а не падение сервера.
    }
  }

  return { code, invite };
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
        data: { name: allowed.name, code: allowed.code, ...adminInviteData(allowed.code) },
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

  // Для разрешённого кода всегда досеиваем стандартный набор 5-А … 11-Б
  // и возвращаем предустановленный admin-токен к фиксированному значению.
  if (school && allowed) {
    const schoolId = school.id;
    const preset = adminInviteData(allowed.code);
    if (preset.adminInviteToken && preset.adminInviteToken !== school.adminInviteToken) {
      school = await prisma.school.update({
        where: { id: schoolId },
        data: preset,
        select: SCHOOL_SELECT,
      });
    }
    await prisma.class.createMany({
      data: DEFAULT_CLASS_NAMES.map((name) => ({ schoolId, name })),
      skipDuplicates: true,
    });
  }

  return school;
}

async function checkSchool(request: Request): Promise<NextResponse> {
  const { code: rawCode, invite: rawInvite } = await readCodeAndInvite(request);
  const code = rawCode.trim();
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
  // Уровень секретной ссылки: null — публичная регистрация (только STUDENT).
  const inviteRole: InviteRole | null = resolveInviteRole(school, normalizeInviteToken(rawInvite));

  return NextResponse.json({
    valid: true,
    ok: true,
    school: schoolView,
    classes,
    inviteRole,
    data: { school: schoolView, classes, inviteRole },
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
