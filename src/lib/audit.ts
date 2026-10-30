import { prisma } from "@/lib/prisma";
import { schoolScope } from "@/lib/admin-tenant";
import type { Role } from "@/types";

/**
 * Журнал действий администрации (модель `AuditLog`).
 *
 * Каждое «опасное» действие персонала — смена роли, блокировка, сброс пароля,
 * принудительное завершение урока, правка объявлений — пишется сюда: кто
 * (userId), что (action), над кем и с какими параметрами (details), с какого
 * IP и когда.
 *
 * Правила работы:
 *  - запись НИКОГДА не ломает основное действие: ошибки только логируются;
 *  - в `details` не попадают пароли и их хеши;
 *  - `details` — короткая JSON-строка (не больше `MAX_DETAILS_LENGTH`).
 */

/** Машинные коды действий. Человекочитаемая подпись — для таблицы журнала. */
export const AUDIT_ACTIONS = {
  "auth.login": "Вход в аккаунт",
  "user.create": "Создание пользователя",
  "user.update": "Правка профиля пользователя",
  "user.role.change": "Смена роли",
  "user.grade.change": "Смена класса",
  "user.password.reset": "Сброс пароля",
  "user.ban": "Блокировка пользователя",
  "user.unban": "Разблокировка пользователя",
  "meeting.force_end": "Принудительное завершение урока",
  "meeting.attendance_close": "Закрытие записей посещаемости",
  "announcement.create": "Создание объявления",
  "announcement.update": "Изменение объявления",
  "announcement.delete": "Удаление объявления",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

/** Подпись действия для UI: неизвестные коды показываем как есть. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTIONS[action as AuditAction] ?? action;
}

/** Сгруппированы ли действия по категориям — для цветовых меток в таблице. */
export function auditActionTone(action: string): "danger" | "success" | "neutral" | "brand" {
  if (action === "user.ban" || action === "meeting.force_end" || action === "announcement.delete") return "danger";
  if (action === "user.unban") return "success";
  if (action === "user.role.change" || action === "user.password.reset") return "brand";
  return "neutral";
}

const MAX_DETAILS_LENGTH = 600;
const MAX_IP_LENGTH = 64;

/** IP автора действия: тот же порядок заголовков, что и у rate-limit. */
export function getRequestIp(request: Request | { headers: Headers }): string | null {
  const headers = request.headers;
  const candidates = [
    headers.get("x-forwarded-for")?.split(",")[0],
    headers.get("x-real-ip"),
    headers.get("cf-connecting-ip"),
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value.slice(0, MAX_IP_LENGTH);
  }
  return null;
}

/** Аккуратно превращает объект деталей в компактную строку. */
export function serializeAuditDetails(details: Record<string, unknown> | null | undefined): string | null {
  if (!details) return null;

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    // Хеши и пароли в журнал не пишем никогда.
    if (/password|secret|token|hash/i.test(key)) continue;
    clean[key] = value;
  }

  if (Object.keys(clean).length === 0) return null;

  try {
    const json = JSON.stringify(clean);
    return json.length > MAX_DETAILS_LENGTH ? `${json.slice(0, MAX_DETAILS_LENGTH - 1)}…` : json;
  } catch {
    return null;
  }
}

export interface AuditInput {
  /** Verified tenant of the actor; never accept this from a request body. */
  schoolId: string;
  /** Автор действия (id пользователя). */
  userId?: string | null;
  action: AuditAction | string;
  details?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * Пишет запись в журнал. Ошибки записи не пробрасываются наружу — журнал
 * вспомогательный, он не должен ломать действие администратора.
 */
export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    const tenant = schoolScope(input.schoolId);
    await prisma.auditLog.create({
      data: {
        ...tenant,
        userId: input.userId ?? null,
        action: input.action,
        details: serializeAuditDetails(input.details),
        ip: input.ip ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] Не удалось записать действие:", error);
  }
}

export interface AuditLogEntry {
  id: string;
  action: string;
  details: string | null;
  ip: string | null;
  createdAt: string;
  actor: { id: string; name: string; role: Role } | null;
}

export interface ListAuditOptions {
  take?: number;
  skip?: number;
  action?: string;
}

/** Последние действия персонала (для страницы журнала и блока в обзоре). */
export async function listAuditLogs(schoolId: string, options: ListAuditOptions = {}): Promise<{
  items: AuditLogEntry[];
  total: number;
}> {
  const take = Math.min(Math.max(options.take ?? 20, 1), 100);
  const skip = Math.max(options.skip ?? 0, 0);
  const where = { ...schoolScope(schoolId), ...(options.action ? { action: options.action } : {}) };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: { user: { select: { id: true, name: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      action: row.action,
      details: row.details,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
      actor: row.user ? { id: row.user.id, name: row.user.name, role: row.user.role as Role } : null,
    })),
  };
}

/** Пытается прочитать `details` как объект — для таблицы журнала. */
export function parseAuditDetails(details: string | null): Record<string, unknown> | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Детали одной строкой для компактного показа: `ключ: значение, ключ: значение`. */
export function formatAuditDetails(details: string | null): string {
  const parsed = parseAuditDetails(details);
  if (!parsed) return details ?? "";

  return Object.entries(parsed)
    .map(([key, value]) => {
      const text =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
      return `${key}: ${text}`;
    })
    .join(" · ");
}
