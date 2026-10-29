import { NextResponse } from "next/server";

import { forceEndMeeting } from "@/lib/admin-meetings";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { getRequestIp, writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canEndMeeting, meetingEndDenyReason } from "@/lib/admin-permissions";
import { requireAdminViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/**
 * POST /api/admin/meetings/[id]/end — принудительно завершить урок.
 *
 * Все участники получают событие `room-closed` и выходят из комнаты, записи
 * посещаемости закрываются, урок помечается завершённым (повторный вход
 * запрещён на 30 минут, кроме ведущего и администратора).
 *
 * Администратор может завершить любой урок, учитель — только свой.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const viewer = await requireAdminViewer();

    const meeting = await prisma.meeting.findFirst({
      where: { id: params.id, schoolId: viewer.schoolId },
      select: { id: true, title: true, meetingCode: true, hostId: true, schoolId: true },
    });
    if (!meeting || !viewer.schoolId || meeting.schoolId !== viewer.schoolId) {
      return jsonError(404, "NOT_FOUND", "Урок не найден");
    }

    const denyReason = meetingEndDenyReason({ id: viewer.id, role: viewer.role }, meeting);
    if (denyReason) {
      return jsonError(403, "FORBIDDEN", denyReason);
    }
    if (!canEndMeeting({ id: viewer.id, role: viewer.role }, meeting)) {
      return jsonError(403, "FORBIDDEN", "Недостаточно прав для завершения урока");
    }

    const result = await forceEndMeeting(meeting.id, viewer.schoolId);

    void writeAuditLog({
      userId: viewer.id,
      schoolId: viewer.schoolId,
      action: "meeting.force_end",
      ip: getRequestIp(request),
      details: {
        meetingId: meeting.id,
        title: meeting.title,
        code: meeting.meetingCode,
        closedSockets: result.closedSockets,
        closedAttendance: result.closedAttendance,
        alreadyClosed: result.alreadyClosed,
      },
    });

    return jsonOk({ meeting, result });
  } catch (error) {
    return handleRouteError(error, "api/admin/meetings/end POST");
  }
}
