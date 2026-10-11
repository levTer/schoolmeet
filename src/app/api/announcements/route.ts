import type { NextResponse } from "next/server";

import { listActiveAnnouncementsForViewer } from "@/lib/announcements";
import { handleRouteError, jsonOk } from "@/lib/api";
import { requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/announcements — активные объявления для текущего пользователя.
 *
 * Ученик видит объявления своей школы и своего класса, учитель и администратор —
 * все. Роут используется, чтобы баннер кабинета обновлялся без перезагрузки.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    const announcements = await listActiveAnnouncementsForViewer({
      id: viewer.id,
      role: viewer.role,
      grade: viewer.grade,
    });

    return jsonOk({ announcements });
  } catch (error) {
    return handleRouteError(error, "api/announcements GET");
  }
}
