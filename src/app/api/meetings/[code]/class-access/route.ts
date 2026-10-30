import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  classCodeGrantSecret,
  normalizeClassCode,
  signClassCodeGrant,
} from "@/lib/class-code";
import { checkMeetingAccess, findMeetingByCode } from "@/lib/meetings";
import { getSchoolViewer } from "@/lib/school-viewer";
import { isValidRoomCode } from "@/lib/realtime";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/meetings/[code]/class-access — вход в урок чужого класса
 * строгой школы по КОДУ КЛАССА.
 *
 * Тело запроса: `{ "classCode": "5B-K7QZM4" }`.
 *
 * Логика (fail-closed):
 *  1. сессия + «живой» зритель из БД (401 иначе);
 *  2. комната существует и принадлежит школе зрителя (иначе 404 — чужой
 *     урок не подтверждаем, как и в `GET /api/meetings/[code]`);
 *  3. урок уже открыт зрителю (свой класс, учитель, админ) — 200 с
 *     `grant: null`, отдельный допуск не нужен;
 *  4. урок другого класса в ГИБКОЙ школе — 403 (код класса не требуется:
 *     гибкая школа пускает всех учеников школы);
 *  5. урок другого класса в СТРОГОЙ школе — сверяем введённый код с
 *     `Class.code` класса расписания (без учёта регистра); при совпадении
 *     выдаём подписанный ОДНОРАЗОВЫЙ допуск (HMAC, час жизни, привязан к
 *     пользователю, классу и комнате) — `src/lib/class-code.ts`.
 *
 * Учителя и администраторы (включая тестовых `admin@schoolmeet.ru` /
 * `fullhouse@schoolmeet.ru`) в этот путь не заходят: они проходят на шаге 3.
 */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }): Promise<NextResponse> {
  const { code } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { ok: false, error: "Войдите в аккаунт", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  if (!isValidRoomCode(code)) {
    return NextResponse.json(
      { ok: false, error: "Некорректный код урока", code: "BAD_ROOM" },
      { status: 400 },
    );
  }

  try {
    // Роль, школа и класс — только из БД, не из JWT (H-01).
    const viewer = await getSchoolViewer(session.user.id);
    if (!viewer) {
      return NextResponse.json(
        { ok: false, error: "Аккаунт не найден", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }

    const meeting = await findMeetingByCode(code);
    if (!meeting) {
      return NextResponse.json(
        { ok: false, error: "Урок с таким кодом не найден", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    // Единое правило доступа (H-02): школа → политика классов → роль.
    const decision = checkMeetingAccess(meeting, {
      id: viewer.id,
      role: viewer.role,
      schoolId: viewer.schoolId,
      classId: viewer.classId,
    });

    // Чужая школа: не подтверждаем существование урока.
    if (!decision.ok && decision.code === "SCHOOL_MISMATCH") {
      return NextResponse.json(
        { ok: false, error: "Урок с таким кодом не найден", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    // Уже есть доступ (свой класс, учитель, админ, ведущий) — допуск не нужен.
    if (decision.ok) {
      const className = meeting.schedule?.classId
        ? (await prisma.class.findUnique({
            where: { id: meeting.schedule.classId },
            select: { name: true },
          }))?.name ?? null
        : null;
      return NextResponse.json({
        ok: true,
        data: { grant: null, reason: "ALREADY_ALLOWED", className },
      });
    }

    const schoolId = meeting.schoolId ?? meeting.schedule?.schoolId ?? meeting.host.schoolId;
    const scheduleClassId = meeting.schedule?.classId;
    const strict = meeting.school?.strictClassIsolation ?? false;

    if (!scheduleClassId || !schoolId) {
      // Здесь быть не должно (свыше бы пропустил), но fail-closed: без класса
      // расписания код класса не выдаём.
      return NextResponse.json(
        { ok: false, error: "К классу урока нельзя выдать допуск", code: "INTERNAL_ERROR" },
        { status: 500 },
      );
    }

    if (!strict) {
      return NextResponse.json(
        {
          ok: false,
          error: "В этой школе код класса не нужен: открыты все уроки школы.",
          code: "CODE_NOT_REQUIRED",
        },
        { status: 403 },
      );
    }

    const schoolClass = await prisma.class.findFirst({
      where: { id: scheduleClassId, schoolId },
      select: { id: true, name: true, code: true },
    });
    if (!schoolClass) {
      return NextResponse.json(
        { ok: false, error: "Урок привязан к несуществующему классу", code: "INTERNAL_ERROR" },
        { status: 500 },
      );
    }

    if (!schoolClass.code) {
      return NextResponse.json(
        {
          ok: false,
          error: "Коды классов в школе ещё не настроены. Обратитесь к администратору.",
          code: "CLASS_CODE_MISSING",
        },
        { status: 409 },
      );
    }

    const entered = normalizeClassCode(await safeReadClassCode(request));
    if (entered !== normalizeClassCode(schoolClass.code)) {
      return NextResponse.json(
        { ok: false, error: "Неверный код класса. Проверьте код, который дал учитель.", code: "CLASS_CODE_INVALID" },
        { status: 403 },
      );
    }

    const grant = signClassCodeGrant(
      {
        userId: viewer.id,
        classId: schoolClass.id,
        schoolId,
        meetingCode: meeting.meetingCode,
        issuedAt: Date.now(),
      },
      classCodeGrantSecret(),
    );

    return NextResponse.json({
      ok: true,
      data: {
        grant,
        reason: "GRANT_ISSUED",
        className: schoolClass.name,
        classCode: schoolClass.code,
      },
    });
  } catch (error) {
    console.error("[class-access] Не удалось выдать допуск по коду класса:", error);
    return NextResponse.json(
      { ok: false, error: "Сервис временно недоступен", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}

/** Тело `{ classCode: "…" }` — бережно, без броска на пустом теле. */
async function safeReadClassCode(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).classCode
      : undefined;
  } catch {
    return undefined;
  }
}
