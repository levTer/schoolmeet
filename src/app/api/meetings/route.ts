import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { createMeeting } from "@/lib/meetings";
import { hasPermission, type Role } from "@/types";

export const dynamic = "force-dynamic";

const TITLE_MIN_LENGTH = 3;
const TITLE_MAX_LENGTH = 80;

/**
 * POST /api/meetings — создать урок и получить короткий код комнаты.
 * Тело: `{ "title": "Математика 101" }`. Код: `matematika-101`.
 * Создавать уроки могут роли с правом `meeting:create` (ADMIN, TEACHER).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { ok: false, error: "Войдите в аккаунт", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const role = session.user.role as Role;
  if (!hasPermission(role, "meeting:create")) {
    return NextResponse.json(
      { ok: false, error: "Создавать уроки могут только учителя и администраторы", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Ожидается JSON с полем title", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const rawTitle = typeof (body as { title?: unknown })?.title === "string" ? (body as { title: string }).title : "";
  const title = rawTitle.trim().replace(/\s+/g, " ");

  if (title.length < TITLE_MIN_LENGTH || title.length > TITLE_MAX_LENGTH) {
    return NextResponse.json(
      {
        ok: false,
        error: `Название урока должно быть от ${TITLE_MIN_LENGTH} до ${TITLE_MAX_LENGTH} символов`,
        code: "VALIDATION_ERROR",
        fields: { title: "Укажите название урока" },
      },
      { status: 422 },
    );
  }

  try {
    const meeting = await createMeeting({ title, hostId: session.user.id });

    return NextResponse.json(
      {
        ok: true,
        data: {
          meeting: {
            id: meeting.id,
            title: meeting.title,
            meetingCode: meeting.meetingCode,
            hostName: meeting.host.name,
            startTime: meeting.startTime.toISOString(),
          },
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[meetings] Не удалось создать урок:", error);
    return NextResponse.json(
      { ok: false, error: "Не удалось создать урок. Попробуйте позже.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
