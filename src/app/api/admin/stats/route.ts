import type { NextResponse } from "next/server";

import { handleRouteError, jsonOk } from "@/lib/api";
import { getAdminOverview, getAdminSecondaryMetrics } from "@/lib/admin-stats";
import { requireCapability, requireAdminViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/stats — метрики и графики страницы обзора.
 *
 * Данные кэшируются на 15 секунд: страница обновляется автоматически, а БД при
 * этом не должна получать десятки одинаковых агрегатов в минуту.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const viewer = await requireAdminViewer();
    requireCapability(viewer, "stats.view");

    const [overview, secondary] = await Promise.all([getAdminOverview(viewer.schoolId), getAdminSecondaryMetrics(viewer.schoolId)]);

    return jsonOk({ overview, secondary });
  } catch (error) {
    return handleRouteError(error, "api/admin/stats");
  }
}
