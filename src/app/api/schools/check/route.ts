import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { checkRequestRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { configuredStrictClassIsolation, isSingleClassSchool } from "@/lib/school-config";
import { normalizeInviteToken, resolveInviteRole, type InviteRole } from "@/lib/invite-rules";
import { inviteTokensForNewSchool } from "@/lib/invite-tokens";
import { canonicalSchoolCode, normalizeSchoolCode } from "@/lib/school-rules";
import { listClassesForSchool } from "@/lib/schools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Коды, которые проверка школы создаёт сама, если их ещё нет в базе.
 * Имена используются только при автосоздании; существующую школу не переименовываем.
 */
const ALLOWED_SCHOOLS = [
  { name: "Лицей Сингулярити", code: "Sinlycem26" },
  { name: "Fullhouse Teem", code: "Fulhouseteem26" },
  { name: "Школа Душа", code: "Anna.Terentieva77" },
] as const;

type AllowedSchool = (typeof ALLOWED_SCHOOLS)[number];

const SCHOOL_SELECT = {
  id: true,
  name: true,
  code: true,
  strictClassIsolation: true,
  teacherInviteToken: true,
  adminInviteToken: true,
} as const;

function serverError(): NextResponse {
  return NextResponse.json({ valid: false, error: "Server Error" }, { status: 500 });
}

function matchAllowedSchool(code: string): AllowedSchool | null {
  const needle = code.trim().toLowerCase();
  return ALLOWED_SCHOOLS.find((school) => school.code.toLowerCase() === needle) ?? null;
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

async function findOrCreateSchool(rawCode: string) {
  // Псевдонимы (`DUSHA`, `SOUL`) раскрываются в код школы из базы, поэтому
  // инструкция «введите DUSHA» ведёт в «Школу Душа» и ничего не ломает.
  const code = canonicalSchoolCode(rawCode) ?? rawCode.trim();
  const allowed = matchAllowedSchool(code);
  const lookup = allowed?.code ?? code;

  let school = await prisma.school.findFirst({
    where: { code: { equals: lookup, mode: "insensitive" } },
    select: SCHOOL_SELECT,
  });

  if (!school && allowed) {
    try {
      school = await prisma.school.create({
        // Токены приглашений выпускает приложение: колонки nullable и
        // DB-level default у них нет (см. `@/lib/invite-tokens`).
        data: {
          name: allowed.name,
          code: allowed.code,
          strictClassIsolation: configuredStrictClassIsolation(allowed.code),
          ...inviteTokensForNewSchool(allowed.code),
        },
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

  /*
    C-01/C-02 (ужесточение): публичная проверка кода школы больше НЕ ПИШЕТ в
    существующую школу. Раньше здесь досыпались invite-токены и
    синхронизировался набор классов — то есть неавторизованный запрос менял
    состояние тенанта. Теперь:
      - токены и классы готовит startup-provisioning (`provisionConfiguredSchools`)
        и `findSchoolByCode` при регистрации;
      - endpoint только читает и возвращает публичные поля школы.
    Создание допускается лишь для ТРЁХ настроенных школ (ALLOWED_SCHOOLS) и
    только если их действительно нет: это делает первый запуск на пустой базе
    самообслуживаемым, но не позволяет создавать произвольные тенанты.
  */

  return school;
}

async function checkSchool(request: Request): Promise<NextResponse> {
  /**
   * Endpoint публичный и раньше умел писать в БД — поэтому получает
   * собственный лимит в дополнение к общему лимиту middleware (20/мин на IP,
   * отдельная корзина «schools-check»): иначе перебором кодов школ можно
   * нагружать БД и провоцировать создание тенантов.
   */
  const limit = checkRequestRateLimit("auth", request.headers, "schools-check");
  if (!limit.result.ok) {
    return NextResponse.json(
      { valid: false, ok: false, error: "Слишком много запросов", code: "RATE_LIMITED" },
      { status: 429, headers: rateLimitHeaders(limit.result) },
    );
  }

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

  /*
    «Одноклассная» школа: форма регистрации не показывает сетку выбора класса,
    а сразу подставляет единственный класс. Признак включается и для
    настроенных одноклассных школ (`SINGLE_CLASS_SCHOOL_CODES`), и для любой
    школы, где реально зарегистрирован ровно один класс.
  */
  const isSingleClass = isSingleClassSchool(school.code) || classes.length === 1;
  const defaultClassId = isSingleClass ? classes[0]?.id ?? null : null;

  // Наружу отдаём ТОЛЬКО публичные поля школы: invite-токены (оба) остаются
  // на сервере и никогда не попадают в JSON ответа. `strictClassIsolation` —
  // публичная политика школы: в гибкой школе поле класса при регистрации
  // необязательно, в строгой — обязательно.
  const schoolView = {
    id: school.id,
    name: school.name,
    code: school.code,
    strictClassIsolation: school.strictClassIsolation,
  };
  // Уровень секретной ссылки: null — публичная регистрация (только STUDENT).
  const inviteRole: InviteRole | null = resolveInviteRole(school, normalizeInviteToken(rawInvite));

  return NextResponse.json({
    valid: true,
    ok: true,
    school: schoolView,
    classes,
    inviteRole,
    isSingleClass,
    defaultClassId,
    data: { school: schoolView, classes, inviteRole, isSingleClass, defaultClassId },
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
