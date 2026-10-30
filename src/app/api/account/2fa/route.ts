import { NextResponse } from "next/server";
import bcryptjs from "bcryptjs";

import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { getRequestIp, writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireViewer } from "@/lib/session-viewer";
import {
  beginTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  countBackupCodes,
  disableTwoFactor,
  isTwoFactorEnabled,
  verifySecondFactor,
} from "@/lib/two-factor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Управление вторым фактором собственного аккаунта.
 *
 *   GET    /api/account/2fa — состояние (включена, сколько резервных кодов)
 *   POST   /api/account/2fa — начать настройку: `{ password }` → секрет и otpauth-ссылка
 *   PUT    /api/account/2fa — подтвердить кодом из приложения: `{ code }` → резервные коды
 *   DELETE /api/account/2fa — выключить: `{ password, code }`
 *
 * Пароль обязателен и при включении, и при выключении: украденной сессии
 * недостаточно, чтобы снять защиту аккаунта.
 */

/** Читает JSON-тело; пустое или битое тело — не исключение, а `{}`. */
async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Проверяет пароль текущего пользователя по хешу из БД. */
async function verifyPassword(userId: string, password: unknown): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
  if (!row) return false;
  return bcryptjs.compare(password, row.password);
}

export async function GET(): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    const user = await prisma.user.findUnique({
      where: { id: viewer.id },
      select: { twoFactorEnabledAt: true, twoFactorBackupCodes: true, role: true },
    });

    return jsonOk({
      enabled: Boolean(user?.twoFactorEnabledAt),
      enabledAt: user?.twoFactorEnabledAt ?? null,
      backupCodesLeft: countBackupCodes(user?.twoFactorBackupCodes),
      // Второй фактор рекомендован всем, для учителей и админов — обязателен
      // после первого входа: эти аккаунты дают доступ к урокам и данным класса.
      requiredForRole: user?.role === "ADMIN" || user?.role === "TEACHER",
    });
  } catch (error) {
    return handleRouteError(error, "api/account/2fa GET");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    const body = await readJson(request);

    if (!(await verifyPassword(viewer.id, body.password))) {
      return jsonError(403, "INVALID_PASSWORD", "Пароль указан неверно");
    }

    const user = await prisma.user.findUnique({
      where: { id: viewer.id },
      select: { email: true },
    });
    if (!user) return jsonError(404, "NOT_FOUND", "Аккаунт не найден");

    const enrollment = await beginTwoFactorEnrollment(viewer.id, user.email);

    // Секрет отдаётся один раз и только владельцу сессии: в БД он лежит
    // зашифрованным, в журнал аудита не попадает.
    return jsonOk({ secret: enrollment.secret, otpauthUri: enrollment.otpauthUri });
  } catch (error) {
    return handleRouteError(error, "api/account/2fa POST");
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    const body = await readJson(request);

    if (typeof body.code !== "string" || body.code.trim() === "") {
      return jsonError(422, "VALIDATION_ERROR", "Введите код из приложения");
    }

    const { backupCodes } = await confirmTwoFactorEnrollment(viewer.id, body.code);

    // Журнал аудита тенант-скоупный: без школы запись не создаём (аккаунт без
    // школы — редкий legacy-случай, и угадывать тенант нельзя).
    if (viewer.schoolId) {
      void writeAuditLog({
        userId: viewer.id,
        schoolId: viewer.schoolId,
        action: "user.2fa.enabled",
        ip: getRequestIp(request),
        details: { method: "totp" },
      });
    }

    // Резервные коды показываются один раз: в БД остаются только хеши.
    return jsonOk({ backupCodes });
  } catch (error) {
    if (error instanceof Error && error.message === "TWO_FACTOR_INVALID_CODE") {
      return jsonError(422, "INVALID_CODE", "Код неверен или истёк. Попробуйте ещё раз.");
    }
    if (error instanceof Error && error.message === "TWO_FACTOR_NOT_STARTED") {
      return jsonError(409, "NOT_STARTED", "Сначала начните настройку двухфакторной защиты");
    }
    return handleRouteError(error, "api/account/2fa PUT");
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    const body = await readJson(request);

    if (!(await verifyPassword(viewer.id, body.password))) {
      return jsonError(403, "INVALID_PASSWORD", "Пароль указан неверно");
    }

    const user = await prisma.user.findUnique({
      where: { id: viewer.id },
      select: {
        twoFactorSecret: true,
        twoFactorEnabledAt: true,
        twoFactorBackupCodes: true,
        twoFactorLastStep: true,
      },
    });

    if (user && isTwoFactorEnabled(user)) {
      // Снять защиту можно только предъявив действующий второй фактор:
      // иначе украденный пароль сразу снимал бы 2FA.
      const secondFactor = await verifySecondFactor(
        { id: viewer.id, ...user },
        typeof body.code === "string" ? body.code : "",
      );
      if (!secondFactor.ok) {
        return jsonError(422, "INVALID_CODE", "Введите код из приложения или резервный код");
      }
    }

    await disableTwoFactor(viewer.id);

    if (viewer.schoolId) {
      void writeAuditLog({
        userId: viewer.id,
        schoolId: viewer.schoolId,
        action: "user.2fa.disabled",
        ip: getRequestIp(request),
      });
    }

    return jsonOk({ enabled: false });
  } catch (error) {
    return handleRouteError(error, "api/account/2fa DELETE");
  }
}
