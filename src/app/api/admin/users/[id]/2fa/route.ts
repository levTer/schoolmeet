import { NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { getRequestIp, writeAuditLog } from "@/lib/audit";
import { getUserForAdmin } from "@/lib/admin-users";
import { prisma } from "@/lib/prisma";
import { requireAdminViewer, requireCapability } from "@/lib/session-viewer";
import { disableTwoFactor, isTwoFactorEnabled } from "@/lib/two-factor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/users/[id]/2fa — снять второй фактор с аккаунта ученика,
 * учителя или другого администратора.
 *
 * Единственный легальный путь восстановления, если человек потерял и телефон,
 * и резервные коды: без него аккаунт пришлось бы удалять вручную в БД.
 *
 * Почему это безопасно:
 *  - доступно только администратору СВОЕЙ школы (`requireAdminViewer` +
 *    `users.password.reset` — та же возможность, что у сброса пароля);
 *  - снятие 2FA само по себе не даёт войти: пароль по-прежнему нужен, и
 *    администратор не видит его и не задаёт здесь;
 *  - действие пишется в журнал аудита (`user.2fa.reset`) с IP администратора.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const viewer = await requireAdminViewer();

    const target = await getUserForAdmin(id, viewer.schoolId);
    if (!target) return jsonError(404, "NOT_FOUND", "Пользователь не найден");

    requireCapability(viewer, "users.password.reset", { id: target.id, role: target.role });

    const before = await prisma.user.findUnique({
      where: { id: target.id },
      select: { twoFactorEnabledAt: true },
    });

    if (before && isTwoFactorEnabled(before)) {
      await disableTwoFactor(target.id);

      void writeAuditLog({
        userId: viewer.id,
        schoolId: viewer.schoolId,
        action: "user.2fa.reset",
        ip: getRequestIp(request),
        details: { target: target.email, targetId: target.id },
      });
    }

    return jsonOk({ twoFactorReset: Boolean(before && isTwoFactorEnabled(before)) });
  } catch (error) {
    return handleRouteError(error, "api/admin/users/[id]/2fa DELETE");
  }
}
