import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { checkMeetingAccess, findMeetingByCode } from "@/lib/meetings";
import { getSchoolViewer } from "@/lib/school-viewer";
import { isValidRoomCode } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/**
 * GET /api/meetings/[code] — данные урока для входа в комнату.
 *
 * Ключ шифрования чата отдаётся ТОЛЬКО после полной проверки доступа:
 *  1. сессия есть (иначе 401);
 *  2. урок принадлежит школе зрителя (иначе 404 — чужой урок не подтверждаем);
 *  3. если урок привязан к классу расписания, STUDENT обязан состоять в этом
 *     классе; учитель и администратор школы проходят (иначе 403 — H-02).
 */
export async function GET(
  _request: Request,
  { params }: { params: { code: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { ok: false, error: "Войдите в аккаунт", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  if (!isValidRoomCode(params.code)) {
    return NextResponse.json(
      { ok: false, error: "Некорректный код урока", code: "BAD_ROOM" },
      { status: 400 },
    );
  }

  try {
    // Роль, школа и класс — только из БД («живой» зритель), не из JWT.
    const viewer = await getSchoolViewer(session.user.id);
    if (!viewer) {
      return NextResponse.json(
        { ok: false, error: "Аккаунт не найден", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }

    const meeting = await findMeetingByCode(params.code);
    const decision = meeting
      ? checkMeetingAccess(meeting, {
          id: viewer.id,
          role: viewer.role,
          schoolId: viewer.schoolId,
          classId: viewer.classId,
        })
      : null;

    if (!meeting || !decision || (!decision.ok && decision.code === "SCHOOL_MISMATCH")) {
      return NextResponse.json(
        { ok: false, error: "Урок с таким кодом не найден", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    if (!decision.ok) {
      return NextResponse.json(
        { ok: false, error: decision.message, code: decision.code },
        { status: decision.status },
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        meeting: {
          id: meeting.id,
          title: meeting.title,
          meetingCode: meeting.meetingCode,
          hostName: meeting.host.name,
          isHost: meeting.hostId === session.user.id,
          encryptionKey: meeting.encryptionKey,
          startTime: meeting.startTime.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("[meetings] Не удалось получить урок:", error);
    return NextResponse.json(
      { ok: false, error: "Сервис временно недоступен", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
