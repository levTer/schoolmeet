import { NextResponse } from "next/server";

import {
  createAnnouncement,
  listAnnouncements,
  validateAnnouncementInput,
} from "@/lib/announcements";
import { handleRouteError, jsonError, jsonOk, parseIntParam } from "@/lib/api";
import { getRequestIp, writeAuditLog } from "@/lib/audit";
import { requireCapability, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/announcements — все объявления школы (включая неактивные).
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireCapability(viewer, "announcements.view");

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") !== "0";
    const announcements = await listAnnouncements({
      take: parseIntParam(searchParams.get("take"), 50, 1, 100),
      includeInactive,
    });

    return jsonOk({ announcements });
  } catch (error) {
    return handleRouteError(error, "api/admin/announcements GET");
  }
}

/**
 * POST /api/admin/announcements — создать объявление.
 *
 * `targetGrade: null` — для всей школы, иначе только для указанного класса.
 * Доступно ADMIN и TEACHER.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireCapability(viewer, "announcements.manage");

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "BAD_REQUEST", "Ожидается JSON с объявлением");
    }

    const validation = validateAnnouncementInput(payload);
    if (!validation.ok) {
      return jsonError(422, "VALIDATION_ERROR", validation.error, { fields: validation.fields });
    }

    const announcement = await createAnnouncement(viewer.id, validation.data);

    void writeAuditLog({
      userId: viewer.id,
      action: "announcement.create",
      ip: getRequestIp(request),
      details: {
        announcementId: announcement.id,
        title: announcement.title,
        targetGrade: announcement.targetGrade ?? "вся школа",
      },
    });

    return jsonOk({ announcement }, 201);
  } catch (error) {
    return handleRouteError(error, "api/admin/announcements POST");
  }
}
