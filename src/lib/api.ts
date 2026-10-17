import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

/**
 * Общие помощники API-роутов: единый формат ответа `{ ok, data }` / `{ ok: false, error, code }`
 * и перевод доменных ошибок в HTTP-статусы.
 */

export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new DomainError(422, "VALIDATION_ERROR", message, fields);
export const forbidden = (message = "Недостаточно прав для этого действия") =>
  new DomainError(403, "FORBIDDEN", message);
export const notFound = (message = "Не найдено") => new DomainError(404, "NOT_FOUND", message);
export const conflict = (message: string, details?: unknown) => new DomainError(409, "CONFLICT", message, undefined, details);

/**
 * 403: у сессии нет школы, поэтому доступ к данным любого тенанта запрещён.
 *
 * Мультиарендность построена на `session.user.schoolId`: маршрут, у которого
 * школа не определена, обязан отказать, а не «угадать» тенант (иначе объявление
 * или урок другой школы утекли бы пользователю без школы).
 */
export const tenantRequired = (message = "Аккаунт не привязан к школе: доступ к данным школы закрыт") =>
  new DomainError(403, "SCHOOL_REQUIRED", message);

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function jsonError(status: number, code: string, error: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, error, code, ...extra }, { status });
}

/**
 * Безопасно читает числовой query-параметр.
 *
 * `Number(null)` и `Number("abc")` дают NaN, а NaN, попав в Prisma (`skip`,
 * `take`), превращается в непонятную ошибку валидации — поэтому приводим
 * значение к целому и зажимаем в границы.
 */
export function parseIntParam(value: string | null, fallback: number, min = 0, max = 1000): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Превращает любое исключение в понятный ответ. Внутренности наружу не отдаём. */
export function handleRouteError(error: unknown, scope: string): NextResponse {
  if (error instanceof DomainError) {
    return jsonError(error.status, error.code, error.message, {
      ...(error.fields ? { fields: error.fields } : {}),
      ...(error.details ? { details: error.details } : {}),
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002")) {
    // P2034 — сбой сериализуемой транзакции, P2002 — гонка на уникальном ключе.
    return jsonError(409, "CONFLICT", "Данные изменились одновременно. Попробуйте ещё раз.");
  }

  console.error(`[${scope}] Непредвиденная ошибка:`, error);
  return jsonError(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера. Попробуйте позже.");
}
