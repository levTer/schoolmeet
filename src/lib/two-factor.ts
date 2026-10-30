/**
 * Двухфакторная аутентификация: настройка, включение и проверка второго фактора.
 *
 * Модель:
 *  - `twoFactorSecret` — секрет TOTP, всегда в зашифрованном виде (`sealSecret`);
 *  - `twoFactorEnabledAt` — единственный признак включённой 2FA: до подтверждения
 *    кода секрет остаётся черновиком настройки и вход не ограничивает;
 *  - `twoFactorBackupCodes` — SHA-256 хеши одноразовых кодов;
 *  - `twoFactorLastStep` — последний принятый шаг TOTP (защита от повторного
 *    использования перехваченного кода).
 *
 * Восстановление: если пользователь потерял и телефон, и резервные коды,
 * 2FA снимает администратор школы через `/api/admin/users/[id]` — действие
 * пишется в журнал аудита (`user.2fa.reset`).
 */
import { prisma } from "@/lib/prisma";
import { constantTimeEqual, openSecret, sealSecret } from "@/lib/secret-box";
import {
  BACKUP_CODE_COUNT,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  normalizeBackupCode,
  otpauthUri,
  verifyTotp,
} from "@/lib/totp";

/** Поля пользователя, нужные для проверки второго фактора. */
export interface TwoFactorUser {
  id: string;
  twoFactorSecret: string | null;
  twoFactorEnabledAt: Date | string | null;
  twoFactorBackupCodes?: string[];
  twoFactorLastStep?: number | null;
}

/** Включена ли 2FA у пользователя. */
export function isTwoFactorEnabled(user: Pick<TwoFactorUser, "twoFactorEnabledAt">): boolean {
  return Boolean(user.twoFactorEnabledAt);
}

/**
 * Черновик секрета для настройки.
 *
 * Секрет сохраняется сразу (зашифрованным), но `twoFactorEnabledAt` не
 * заполняется: если пользователь закроет страницу, 2FA останется выключенной,
 * а следующий вызов перезапишет черновик новым секретом.
 */
export async function beginTwoFactorEnrollment(
  userId: string,
  account: string,
): Promise<{ secret: string; otpauthUri: string }> {
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorSecret: sealSecret(secret),
      // Неподтверждённая настройка никогда не должна случайно стать активной.
      twoFactorEnabledAt: null,
      twoFactorBackupCodes: [],
      twoFactorLastStep: null,
    },
  });

  return { secret, otpauthUri: otpauthUri({ secret, account }) };
}

/**
 * Подтверждение настройки: проверяет код из приложения, включает 2FA и выдаёт
 * резервные коды. Открытый текст кодов возвращается РОВНО ОДИН РАЗ — в базе
 * остаются только хеши.
 */
export async function confirmTwoFactorEnrollment(
  userId: string,
  code: string,
): Promise<{ backupCodes: string[] }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorEnabledAt: true },
  });

  if (!user?.twoFactorSecret) {
    throw new Error("TWO_FACTOR_NOT_STARTED");
  }

  const secret = openSecret(user.twoFactorSecret);
  const step = verifyTotp(secret, code);
  if (step === null) {
    throw new Error("TWO_FACTOR_INVALID_CODE");
  }

  const backupCodes = generateBackupCodes(BACKUP_CODE_COUNT);
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabledAt: new Date(),
      twoFactorBackupCodes: backupCodes.map(hashBackupCode),
      twoFactorLastStep: step,
    },
  });

  return { backupCodes };
}

export type SecondFactorResult =
  | { ok: true; method: "totp" | "backup" }
  | { ok: false; reason: "NOT_ENABLED" | "INVALID" | "REPLAY" | "BROKEN_SECRET" };

/**
 * Проверка второго фактора при входе.
 *
 * Принимает либо 6-значный код TOTP, либо резервный код. Каждый резервный код
 * срабатывает один раз и сразу удаляется из списка; код TOTP нельзя повторить
 * в пределах окна (номер шага должен расти).
 */
export async function verifySecondFactor(user: TwoFactorUser, rawCode: string): Promise<SecondFactorResult> {
  if (!isTwoFactorEnabled(user)) return { ok: false, reason: "NOT_ENABLED" };
  if (!user.twoFactorSecret) return { ok: false, reason: "BROKEN_SECRET" };

  let secret: string;
  try {
    secret = openSecret(user.twoFactorSecret);
  } catch {
    // Ключ шифрования сменился или строка повреждена: входить вслепую нельзя,
    // снимает 2FA администратор.
    return { ok: false, reason: "BROKEN_SECRET" };
  }

  const code = (rawCode ?? "").trim();
  if (!code) return { ok: false, reason: "INVALID" };

  const step = verifyTotp(secret, code);
  if (step !== null) {
    const lastStep = user.twoFactorLastStep ?? null;
    if (lastStep !== null && step <= lastStep) return { ok: false, reason: "REPLAY" };

    await prisma.user.update({ where: { id: user.id }, data: { twoFactorLastStep: step } });
    return { ok: true, method: "totp" };
  }

  // Резервный код: сравниваем хеши постоянное по времени, найденный — удаляем.
  const hashed = hashBackupCode(normalizeBackupCode(code));
  const stored = user.twoFactorBackupCodes ?? [];
  const matchIndex = stored.findIndex((entry) => constantTimeEqual(entry, hashed));
  if (matchIndex === -1) return { ok: false, reason: "INVALID" };

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorBackupCodes: stored.filter((_, index) => index !== matchIndex) },
  });

  return { ok: true, method: "backup" };
}

/**
 * Отключение 2FA самим пользователем (после проверки пароля и второго фактора
 * в API-роуте). Администратор снимает 2FA отдельной ручкой — см. роут.
 */
export async function disableTwoFactor(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      twoFactorBackupCodes: [],
      twoFactorLastStep: null,
    },
  });
}

/** Сколько резервных кодов осталось (для статуса на странице безопасности). */
export function countBackupCodes(codes: string[] | undefined | null): number {
  return (codes ?? []).length;
}
