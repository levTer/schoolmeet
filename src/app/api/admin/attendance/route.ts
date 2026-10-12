import type { NextResponse } from "next/server";

import { listAttendance } from "@/lib/attendance";
import { handleRouteError, jsonError, jsonOk, parseIntParam } from "@/lib/api";
import { parseGrade } from "@/lib/admin-users";
import { requireCapability, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/attendance — журнал посещаемости видеоуроков.
 *
 * Параметры: `meetingId` (показать только один урок), `grade`, `limit`, `offset`.
 * В строке: кто, во сколько вошёл и вышел и сколько минут пробыл.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireCapability(viewer, "attendance.view");
    if (!viewer.schoolId) return jsonError(409, "SCHOOL_REQUIRED", "Аккаунт не привязан к школе");

    const { searchParams } = new URL(request.url);
    const result = await listAttendance({
      schoolId: viewer.schoolId,
      meetingId: searchParams.get("meetingId") ?? undefined,
      grade: parseGrade(searchParams.get("grade")),
      limit: parseIntParam(searchParams.get("limit"), 30, 1, 200),
      offset: parseIntParam(searchParams.get("offset"), 0, 0),
    });

    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error, "api/admin/attendance GET");
  }
}
