import { NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { getRequestIp, writeAuditLog } from "@/lib/audit";
import { normalizeInviteToken, resolveInviteRole } from "@/lib/invite-rules";
import { prisma } from "@/lib/prisma";
import { getRealtimeControl } from "@/lib/realtime-control";
import { requireViewer } from "@/lib/session-viewer";
import { findSchoolByCode, getSchoolInviteSummary } from "@/lib/schools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/promote — повышение УЖЕ вошедшего пользователя до роли ADMIN.
 *
 * Сценарий секретной ссылки администратора (`?invite=` совпадает с
 * `adminInviteToken` школы): пользователь авторизован, поэтому вместо формы
 * регистрации ему показывают окно «Повысить ваш аккаунт до ADMIN?». Этот
 * роут применяет повышение после подтверждения.
 *
 * Проверки: живая сессия (`requireViewer`), токен принадлежит школе с
 * указанным `schoolCode`, аккаунт не в чужой школе и не заблокирован.
 * Действие пишется в журнал аудита (`user.role.change`).
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "BAD_REQUEST", "Ожидается JSON с кодом школы и токеном приглашения");
    }

    const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const schoolCode = typeof raw.schoolCode === "string" ? raw.schoolCode : "";
    const inviteFromQuery = new URL(request.url).searchParams.get("invite");
    const inviteToken = normalizeInviteToken(raw.invite ?? inviteFromQuery);

    const school = await findSchoolByCode(schoolCode);
    if (!school) {
      return jsonError(422, "SCHOOL_NOT_FOUND", "Школа с таким кодом не найдена", {
        fields: { schoolCode: "Проверьте код школы" },
      });
    }

    const schoolInvites = await getSchoolInviteSummary(school.id);
    const inviteRole = resolveInviteRole(schoolInvites, inviteToken);
    if (inviteRole !== "ADMIN") {
      return jsonError(
        403,
        "INVALID_INVITE",
        "Ссылка недействительна или не является ссылкой Администратора",
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: viewer.id },
      select: { id: true, name: true, email: true, role: true, schoolId: true, isBanned: true },
    });
    if (!user) return jsonError(401, "UNAUTHORIZED", "Аккаунт не найден");
    if (user.isBanned) return jsonError(403, "ACCOUNT_BANNED", "Аккаунт заблокирован администратором");

    if (user.schoolId && user.schoolId !== school.id) {
      return jsonError(422, "SCHOOL_MISMATCH", "Ссылка относится к другой школе", {
        fields: { schoolCode: "Ваш аккаунт зарегистрирован в другой школе" },
      });
    }

    if (user.role === "ADMIN") {
      return jsonOk({
        alreadyAdmin: true,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        role: "ADMIN",
        // Аккаунт без школы закрепляем за школой, выдавшей ссылку.
        ...(user.schoolId ? {} : { schoolId: school.id }),
        // Смена роли отзывает все ранее выпущенные JWT и сокет-сессии (H-06).
        sessionVersion: { increment: 1 },
      },
      select: { id: true, name: true, email: true, role: true },
    });

    // Живые сокеты пользователя рвём сразу: новая роль должна подтянуться при
    // следующем рукопожатии, а не «доехать» по старому соединению.
    const control = getRealtimeControl();
    const sessions =
      control?.disconnectUser(user.id, {
        reason: "session_revoked",
        message: "Роль аккаунта изменена. Войдите в аккаунт заново.",
      }) ?? 0;

    await writeAuditLog({
      userId: user.id,
      schoolId: school.id,
      action: "user.role.change",
      details: { target: user.email, from: user.role, to: "ADMIN", via: "admin-invite", sessions },
      ip: getRequestIp(request),
    });

    return jsonOk({
      alreadyAdmin: false,
      user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role },
      sessions,
    });
  } catch (error) {
    return handleRouteError(error, "[api/auth/promote]");
  }
}

/** GET /api/auth/promote — подсказка для ручных проверок. */
export function GET(): NextResponse {
  return jsonError(405, "METHOD_NOT_ALLOWED", "Используйте метод POST");
}
