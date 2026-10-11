import type { NextResponse } from "next/server";

import { handleRouteError, jsonOk } from "@/lib/api";
import { listActiveMeetings } from "@/lib/admin-meetings";
import { finishStaleAttendance } from "@/lib/attendance";
import { requireCapability, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/meetings — текущие видеоуроки.
 *
 * Возвращает учителя, класс и предмет (из расписания либо по участникам),
 * количество учеников в комнате и признак «идёт прямо сейчас».
 *
 * Заодно закрывает «зависшие» записи посещаемости (сервер упал, выход не
 * зафиксировался) — админ-панель показывает честную картину.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireCapability(viewer, "meetings.view");

    await finishStaleAttendance();

    const summary = await listActiveMeetings();
    return jsonOk(summary);
  } catch (error) {
    return handleRouteError(error, "api/admin/meetings GET");
  }
}
