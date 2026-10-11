import type { NextResponse } from "next/server";

import { handleRouteError, jsonOk, parseIntParam } from "@/lib/api";
import { listAuditLogs } from "@/lib/audit";
import { requireCapability, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit — журнал действий администрации.
 * Доступен только роли ADMIN: там видно, кто кого блокировал и что менял.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireCapability(viewer, "audit.view");

    const { searchParams } = new URL(request.url);
    const result = await listAuditLogs({
      take: parseIntParam(searchParams.get("take"), 40, 1, 200),
      skip: parseIntParam(searchParams.get("skip"), 0, 0),
      action: searchParams.get("action") ?? undefined,
    });

    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error, "api/admin/audit GET");
  }
}
