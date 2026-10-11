import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { findMeetingByCode } from "@/lib/meetings";
import { isValidRoomCode } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/**
 * GET /api/meetings/[code] — данные урока для входа в комнату.
 * Доступно только авторизованным пользователям. Ключ шифрования чата отдаётся
 * только в этом ответе, и только после проверки сессии.
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
    const meeting = await findMeetingByCode(params.code);
    if (!meeting) {
      return NextResponse.json(
        { ok: false, error: "Урок с таким кодом не найден", code: "NOT_FOUND" },
        { status: 404 },
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
