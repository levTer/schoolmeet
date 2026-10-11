import { NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { createLesson, listLessonsForViewer } from "@/lib/schedule";
import { validateCreateLesson } from "@/lib/schedule-rules";
import { requireRole, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/schedule — уроки, доступные текущему пользователю.
 *   ученик → только свой класс; учитель → свои уроки; администратор → всё.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    const lessons = await listLessonsForViewer(viewer);
    return jsonOk({ lessons });
  } catch (error) {
    return handleRouteError(error, "api/schedule GET");
  }
}

/**
 * POST /api/schedule — создать урок (учитель или администратор).
 * Тело: `{ subjectId, grade, dayOfWeek, startTime, endTime, room? }`.
 * Пересечения по классу, учителю и кабинету возвращаются в `details.conflicts`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireRole(viewer, ["TEACHER", "ADMIN"], "Расписание может редактировать только учитель или администратор");

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "BAD_REQUEST", "Ожидается JSON с данными урока");
    }

    const validation = validateCreateLesson(payload);
    if (!validation.ok) {
      return jsonError(422, "VALIDATION_ERROR", validation.error, { fields: validation.fields });
    }

    const lesson = await createLesson(validation.data, viewer);
    return jsonOk({ lesson }, 201);
  } catch (error) {
    return handleRouteError(error, "api/schedule POST");
  }
}

