import type { NextResponse } from "next/server";

import { handleRouteError, jsonOk } from "@/lib/api";
import { getRequestIp, writeAuditLog } from "@/lib/audit";
import { endMeetingByActor } from "@/lib/end-meeting";
import { requireSchoolViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ code?: string; id?: string }>;
}

/**
 * POST /api/meetings/[id]/end — завершить активный урок для всех участников.
 *
 * Маршрут размещён в динамическом сегменте `[code]`, чтобы не конфликтовать с
 * соседним `src/app/api/meetings/[code]/route.ts` в Next.js App Router, и
 * принимает как `Meeting.id`, так и `Meeting.meetingCode` строго внутри школы
 * вызывающего пользователя (`viewer.schoolId`).
 *
 * Доступ: ведущий урока (`hostId === viewer.id`) или `ADMIN` той же школы.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<NextResponse> {
  const { code, id } = await params;
  try {
    const viewer = await requireSchoolViewer();
    const identifier = code ?? id ?? "";

    const result = await endMeetingByActor(identifier, {
      id: viewer.id,
      role: viewer.role,
      schoolId: viewer.schoolId,
      isBanned: viewer.isBanned,
    });

    void writeAuditLog({
      userId: viewer.id,
      schoolId: viewer.schoolId,
      action: "meeting.force_end",
      ip: getRequestIp(request),
      details: {
        meetingId: result.meetingId,
        title: result.title,
        code: result.meetingCode,
        closedSockets: result.closedSockets,
        closedAttendance: result.closedAttendance,
        alreadyEnded: result.alreadyEnded,
      },
    });

    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error, "api/meetings/end POST");
  }
}
