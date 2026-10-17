import type { NextResponse } from "next/server";

import { listActiveAnnouncementsForViewer } from "@/lib/announcements";
import { handleRouteError, jsonOk } from "@/lib/api";
import { requireSchoolViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/announcements — активные объявления СВОЕЙ школы.
 *
 * Ученик видит объявления своей школы и своего класса, учитель и администратор —
 * все объявления школы. Школа берётся исключительно из сессии
 * (`requireSchoolViewer`): без неё доступ запрещён (403 `SCHOOL_REQUIRED`).
 * Роут используется, чтобы баннер кабинета обновлялся без перезагрузки.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const viewer = await requireSchoolViewer();
    const announcements = await listActiveAnnouncementsForViewer({
      id: viewer.id,
      role: viewer.role,
      schoolId: viewer.schoolId,
      grade: viewer.grade,
    });

    return jsonOk({ announcements });
  } catch (error) {
    return handleRouteError(error, "api/announcements GET");
  }
}
