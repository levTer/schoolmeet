import { NextResponse } from "next/server";

import {
  createAnnouncement,
  listAnnouncements,
  validateAnnouncementInput,
} from "@/lib/announcements";
import { handleRouteError, jsonError, jsonOk, parseIntParam } from "@/lib/api";
import { getRequestIp, writeAuditLog } from "@/lib/audit";
import { requireCapability, requireSchoolViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/announcements — все объявления СВОЕЙ школы (включая неактивные).
 *
 * Тенант берётся из сессии (`requireSchoolViewer`): межшкольный список больше
 * недоступен (исправление H-03).
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireSchoolViewer();
    requireCapability(viewer, "announcements.view");

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") !== "0";
    const announcements = await listAnnouncements({
      schoolId: viewer.schoolId,
      take: parseIntParam(searchParams.get("take"), 50, 1, 100),
      includeInactive,
    });

    return jsonOk({ announcements });
  } catch (error) {
    return handleRouteError(error, "api/admin/announcements GET");
  }
}

/**
 * POST /api/admin/announcements — создать объявление в своей школе.
 *
 * `targetGrade: null` — для всей школы, иначе только для указанного класса.
 * Доступно только ADMIN: раздел /admin и API /api/admin/* закрыты для TEACHER/STUDENT.
 *
 * `schoolId` НИКОГДА не берётся из тела запроса — только из сессии.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireSchoolViewer();
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

    const announcement = await createAnnouncement({
      authorId: viewer.id,
      schoolId: viewer.schoolId,
      input: validation.data,
    });

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
