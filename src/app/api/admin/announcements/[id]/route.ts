import { NextResponse } from "next/server";

import {
  deleteAnnouncement,
  getAnnouncement,
  updateAnnouncement,
  validateAnnouncementInput,
} from "@/lib/announcements";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { getRequestIp, writeAuditLog } from "@/lib/audit";
import { requireCapability, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/**
 * PATCH /api/admin/announcements/[id] — изменить объявление или снять его с показа
 * (`isActive: false`). Все правки попадают в журнал действий.
 */
export async function PATCH(request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireCapability(viewer, "announcements.manage");

    const existing = await getAnnouncement(params.id);
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
    const announcement = await updateAnnouncement(params.id, {
      ...(raw.title !== undefined ? { title: validation.data.title } : {}),
      ...(raw.content !== undefined ? { content: validation.data.content } : {}),
      ...(raw.targetGrade !== undefined ? { targetGrade: validation.data.targetGrade } : {}),
      ...(raw.isActive !== undefined ? { isActive: validation.data.isActive } : {}),
    });

    void writeAuditLog({
      userId: viewer.id,
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

/** DELETE /api/admin/announcements/[id] — удалить объявление. */
export async function DELETE(request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireCapability(viewer, "announcements.manage");

    const existing = await getAnnouncement(params.id);
    if (!existing) return jsonError(404, "NOT_FOUND", "Объявление не найдено");

    await deleteAnnouncement(params.id);

    void writeAuditLog({
      userId: viewer.id,
      action: "announcement.delete",
      ip: getRequestIp(request),
      details: { announcementId: existing.id, title: existing.title },
    });

    return jsonOk({ deleted: true });
  } catch (error) {
    return handleRouteError(error, "api/admin/announcements DELETE");
  }
}
