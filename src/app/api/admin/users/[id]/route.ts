import { NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { getUserForAdmin, updateUserAsAdmin, validateUserUpdate } from "@/lib/admin-users";
import { invalidateAdminOverview } from "@/lib/admin-stats";
import { getRequestIp, writeAuditLog } from "@/lib/audit";
import { closeAttendanceForUser } from "@/lib/attendance";
import { prisma } from "@/lib/prisma";
import { getRealtimeControl } from "@/lib/realtime-control";
import { requireCapability, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/** Сколько активных администраторов осталось бы после смены роли/блокировки. */
async function countActiveAdmins(excludingId: string): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN", isBanned: false, id: { not: excludingId } } });
}

/**
 * PATCH /api/admin/users/[id] — изменить пользователя.
 *
 * Поддерживаются: имя, роль, класс, сброс пароля (`password`) и блокировка
 * (`isBanned`). Каждое поле проверяется отдельным правом
 * (`admin-permissions.ts`), все изменения пишутся в журнал аудита, а при
 * блокировке живые сокет-сессии пользователя рвутся немедленно.
 */
export async function PATCH(request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();

    const target = await getUserForAdmin(params.id);
    if (!target) {
      return jsonError(404, "NOT_FOUND", "Пользователь не найден");
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "BAD_REQUEST", "Ожидается JSON с изменениями");
    }

    const validation = validateUserUpdate(payload);
    if (!validation.ok) {
      return jsonError(422, "VALIDATION_ERROR", validation.error, { fields: validation.fields });
    }

    const patch = validation.data;
    const targetRef = { id: target.id, role: target.role };

    /* --- Права: каждое поле — отдельная возможность ---------------------- */
    if (patch.name !== undefined) requireCapability(viewer, "users.edit", targetRef);
    if (patch.grade !== undefined) requireCapability(viewer, "users.grade.change", targetRef);
    if (patch.password !== undefined) requireCapability(viewer, "users.password.reset", targetRef);
    if (patch.isBanned !== undefined) requireCapability(viewer, "users.ban", targetRef);
    if (patch.role !== undefined) {
      requireCapability(viewer, "users.role.change", targetRef);
    }

    /* --- Защита от потери доступа к платформе ---------------------------- */
    const wouldLoseAdmin =
      target.role === "ADMIN" &&
      ((patch.role !== undefined && patch.role !== "ADMIN") || patch.isBanned === true);

    if (wouldLoseAdmin && (await countActiveAdmins(target.id)) === 0) {
      return jsonError(
        409,
        "LAST_ADMIN",
        "Это последний активный администратор: сначала назначьте другого администратора",
      );
    }

    const { user, changes, sessionsRevoked } = await updateUserAsAdmin(target.id, patch);
    invalidateAdminOverview();

    const ip = getRequestIp(request);
    const base = { target: user.email, targetId: user.id };

    /* --- Журнал аудита: по записи на каждое смысловое изменение ---------- */
    if (patch.role !== undefined && patch.role !== target.role) {
      void writeAuditLog({
        userId: viewer.id,
        action: "user.role.change",
        ip,
        details: { ...base, from: target.role, to: patch.role },
      });
    }
    if (changes.grade !== undefined) {
      void writeAuditLog({ userId: viewer.id, action: "user.grade.change", ip, details: { ...base, ...changes } });
    }
    if (patch.name !== undefined && changes.name !== undefined) {
      void writeAuditLog({
        userId: viewer.id,
        action: "user.update",
        ip,
        details: { ...base, name: user.name },
      });
    }
    if (patch.password !== undefined) {
      void writeAuditLog({ userId: viewer.id, action: "user.password.reset", ip, details: base });
    }

    /* --- Отзыв сессий: сокеты рвём сразу, JWT аннулирует jwt-callback ---- */
    let sessions = 0;
    let controlAvailable = true;

    /**
     * Раньше живые сокеты рвались только при блокировке: учитель, лишённый
     * роли во время урока, сохранял права модератора до переподключения, а
     * смена пароля вообще не отзывала сессии (находка H-06). Теперь любое из
     * этих действий поднимает `User.sessionVersion` (см. `updateUserAsAdmin`),
     * аннулирует JWT и разрывает активные сокеты.
     */
    if (sessionsRevoked) {
      const control = getRealtimeControl();
      controlAvailable = control !== null;
      sessions =
        control?.disconnectUser(user.id, {
          reason: "session_revoked",
          message: "Данные аккаунта изменены администратором. Войдите в аккаунт заново.",
        }) ?? 0;

      void writeAuditLog({
        userId: viewer.id,
        action: "user.session.revoke",
        ip,
        details: { ...base, sessions, controlAvailable },
      });
    }

    /* --- Блокировка: мгновенный разрыв сокет-сессий ---------------------- */
    if (patch.isBanned !== undefined && patch.isBanned !== target.isBanned) {
      if (patch.isBanned) {
        await closeAttendanceForUser(user.id);
      }

      void writeAuditLog({
        userId: viewer.id,
        action: patch.isBanned ? "user.ban" : "user.unban",
        ip,
        details: { ...base, sessions },
      });
    }

    return jsonOk({
      user,
      disconnect: { sessions, controlAvailable, revoked: sessionsRevoked },
      changes,
    });
  } catch (error) {
    return handleRouteError(error, "api/admin/users PATCH");
  }
}

/**
 * GET /api/admin/users/[id] — карточка пользователя (для модалки редактирования).
 */
export async function GET(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireCapability(viewer, "users.view");

    const user = await getUserForAdmin(params.id);
    if (!user) return jsonError(404, "NOT_FOUND", "Пользователь не найден");

    const control = getRealtimeControl();
    return jsonOk({ user: { ...user, isOnline: control?.isUserOnline(user.id) ?? false } });
  } catch (error) {
    return handleRouteError(error, "api/admin/users[id] GET");
  }
}
