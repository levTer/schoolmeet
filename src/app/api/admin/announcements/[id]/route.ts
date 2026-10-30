import { NextResponse } from "next/server";

import {
  deleteAnnouncement,
  getAnnouncement,
  updateAnnouncement,
  validateAnnouncementInput,
} from "@/lib/announcements";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { getRequestIp, writeAuditLog } from "@/lib/audit";
import { requireCapability, requireAdminViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/admin/announcements/[id] — изменить объявление СВОЕЙ школы или
 * снять его с показа (`isActive: false`). Все правки попадают в журнал действий.
 *
 * Чужое объявление (другой `schoolId`) невидимо: `getAnnouncement` и
 * `updateAnnouncement` фильтруют по школе сессии.
 */
export async function PATCH(request: Request, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;
  try {
    const viewer = await requireAdminViewer();
    requireCapability(viewer, "announcements.manage");

    const existing = await getAnnouncement(id, viewer.schoolId);
    if (!existing) return jsonError(404, "NOT_FOUND", "Объявление не найдено");

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "BAD_REQUEST", "Ожидается JSON с изменениями");
    }

    const validation = validateAnnouncementInput(payload, { partial: true });
    if (!validation.ok) {
      return jsonError(422, "VALIDATION_ERROR", validation.error, { fields: validation.fields });
    }

    // Для частичного обновления берём только переданные поля.
    const raw = payload as Record<string, unknown>;
    const announcement = await updateAnnouncement(id, viewer.schoolId, {
      ...(raw.title !== undefined ? { title: validation.data.title } : {}),
      ...(raw.content !== undefined ? { content: validation.data.content } : {}),
      ...(raw.targetGrade !== undefined ? { targetGrade: validation.data.targetGrade } : {}),
      ...(raw.isActive !== undefined ? { isActive: validation.data.isActive } : {}),
    });

    void writeAuditLog({
      userId: viewer.id,
      schoolId: viewer.schoolId,
      action: "announcement.update",
      ip: getRequestIp(request),
      details: {
        announcementId: announcement.id,
        title: announcement.title,
        isActive: announcement.isActive,
      },
    });

    return jsonOk({ announcement });
  } catch (error) {
    return handleRouteError(error, "api/admin/announcements PATCH");
  }
}

/** DELETE /api/admin/announcements/[id] — удалить объявление своей школы. */
export async function DELETE(request: Request, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;
  try {
    const viewer = await requireAdminViewer();
    requireCapability(viewer, "announcements.manage");

    const existing = await getAnnouncement(id, viewer.schoolId);
    if (!existing) return jsonError(404, "NOT_FOUND", "Объявление не найдено");

    const deleted = await deleteAnnouncement(id, viewer.schoolId);
    if (!deleted) return jsonError(404, "NOT_FOUND", "Объявление не найдено");

    void writeAuditLog({
      userId: viewer.id,
      schoolId: viewer.schoolId,
      action: "announcement.delete",
      ip: getRequestIp(request),
      details: { announcementId: existing.id, title: existing.title },
    });

    return jsonOk({ deleted: true });
  } catch (error) {
    return handleRouteError(error, "api/admin/announcements DELETE");
  }
}
