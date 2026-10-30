import { NextResponse } from "next/server";
import bcryptjs from "bcryptjs";

import { jsonError, jsonOk } from "@/lib/api";
import { loginLockStatus, registerLoginFailure } from "@/lib/login-guard";
import { prisma } from "@/lib/prisma";
import { checkRequestRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { isTwoFactorEnabled } from "@/lib/two-factor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/2fa/check — нужен ли код подтверждения для этого входа.
 *
 * Зачем отдельный шаг: NextAuth для неверного пароля и для отсутствующего
 * второго фактора возвращает один и тот же `CredentialsSignin`, поэтому форма
 * не может понять, что пора показать поле «код». Здесь мы проверяем ТОЛЬКО
 * пароль и отвечаем одним булевым флагом.
 *
 * Что это не ломает:
 *  - перебор пароля по-прежнему ограничен тем же счётчиком (`login-guard`),
 *    что и обычный вход: неудачная проверка инкрементит провалы;
 *  - запрос не выпускает сессию и ничего не меняет в БД;
 *  - при неверном пароле ответ неотличим от несуществующего аккаунта
 *    (сравнение с фиктивным хешем выравнивает время ответа);
 *  - успешная проверка пароля НЕ сбрасывает счётчик провалов: сброс делает
 *    только полноценный вход с обоими факторами.
 */
const DUMMY_HASH = "$2a$10$C7Mtd3kFpXQ0dQ0m6fW3pe0m0jVQ0Yh9h7oQe2VQm2r9wS0a3xW1u";

export async function POST(request: Request): Promise<NextResponse> {
  const limit = checkRequestRateLimit("auth", request.headers, "2fa-check");
  if (!limit.result.ok) {
    return NextResponse.json(
      { ok: false, code: "RATE_LIMITED", error: "Слишком много попыток входа. Попробуйте позже." },
      { status: 429, headers: rateLimitHeaders(limit.result) },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, "BAD_REQUEST", "Ожидается JSON с email и паролем");
  }

  const record = (payload ?? {}) as Record<string, unknown>;
  const email = typeof record.email === "string" ? record.email.toLowerCase().trim() : "";
  const password = typeof record.password === "string" ? record.password : "";
  if (!email || !password) {
    return jsonError(422, "VALIDATION_ERROR", "Укажите email и пароль");
  }

  const lock = loginLockStatus(email);
  if (lock.locked) {
    return jsonError(429, "ACCOUNT_LOCKED", "Слишком много неудачных попыток. Попробуйте позже.");
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { password: true, twoFactorEnabledAt: true, isBanned: true },
  });

  // Для несуществующего аккаунта считаем хеш вхолостую — иначе по времени
  // ответа можно перечислять зарегистрированные адреса.
  const valid = await bcryptjs.compare(password, user?.password ?? DUMMY_HASH);

  if (!user || !valid) {
    registerLoginFailure(email);
    return jsonError(401, "INVALID_CREDENTIALS", "Неверный email или пароль");
  }

  if (user.isBanned) {
    return jsonError(403, "ACCOUNT_BANNED", "Аккаунт заблокирован администратором школы");
  }

  return jsonOk({ twoFactorRequired: isTwoFactorEnabled(user) });
}
