import { NextResponse } from "next/server";

import { badRequest, handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSchoolPolicy } from "@/lib/schools";
import { requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * POST /api/classes/membership — быстрое переключение класса ученика
 * (гибкие школы). Тело: `{ "classId": "…" }`.
 *
 * Правила:
 *  - только роль STUDENT (у учителей/админов класса нет);
 *  - только ГИБКИЕ школы (`strictClassIsolation = false`): в строгих
 *    класса назначается администратором (вход в чужой класс — по коду);
 *  - класс обязан существовать и принадлежать школе ученика (тенант —
 *    только из сессии, из тела запроса берётся один `classId`);
 *  - `User.sessionVersion` НЕ поднимается: класс — не привилегия, доступ к
 *    урокам проверяется по «живой» записи из БД (`getSchoolViewer`), а bump
 *    версии аннулировал бы активный токен. JWT перечитается при
 *    `session.update()` или на ближайшей минутной сверке.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();

    if (viewer.role !== "STUDENT") {
      return jsonError(403, "ROLE_FORBIDDEN", "Сменить класс может только ученик");
    }
    if (!viewer.schoolId) {
      return jsonError(409, "SCHOOL_REQUIRED", "Аккаунт не привязан к школе");
    }

    let classId: unknown;
    try {
      const body: unknown = await request.json();
      classId = typeof body === "object" && body !== null ? (body as Record<string, unknown>).classId : undefined;
    } catch {
      classId = undefined;
    }
    if (typeof classId !== "string" || !classId.trim()) {
      throw badRequest("Укажите класс", { classId: "Класс не указан" });
    }

    const policy = await getSchoolPolicy(viewer.schoolId);
    if (!policy) {
      return jsonError(404, "SCHOOL_NOT_FOUND", "Школа не найдена");
    }
    if (policy.strictClassIsolation) {
      return jsonError(
        403,
        "STRICT_SCHOOL",
        "В строгой школе класс назначается администратором",
      );
    }

    const schoolClass = await prisma.class.findFirst({
      where: { id: classId.trim(), schoolId: viewer.schoolId },
      select: { id: true, name: true },
    });
    if (!schoolClass) {
      throw badRequest("Класс не найден в вашей школе", { classId: "Класс не найден" });
    }

    const updated = await prisma.user.update({
      where: { id: viewer.id },
      data: { classId: schoolClass.id },
      select: { classId: true },
    });

    return jsonOk({ classId: updated.classId, className: schoolClass.name });
  } catch (error) {
    return handleRouteError(error, "api/classes/membership POST");
  }
}
