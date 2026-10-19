/**
 * Правила приватных сообщений чата урока (чистый TypeScript, без Prisma и DOM).
 *
 * Сообщение урока может быть публичным (`recipientId = null` — видит вся комната)
 * или приватным (адресовано одному участнику). Модуль отвечает на два вопроса:
 *  1. кого считать получателем при отправке (`resolveRecipientId`);
 *  2. какие сообщения показывать конкретному зрителю (`canViewChatMessage`,
 *     `chatVisibilityWhere`);
 *  3. кому можно закреплять сообщение в плашке чата (`canPinChatMessage`).
 *
 * Правила импортируют и сервер (сокеты, выборка истории), и клиент (лента чата),
 * чтобы приватное сообщение не «протекло» третьему участнику из-за расхождения
 * логики между слоями.
 */

import type { Role } from "@/types";

/** Значение селекта «Всем» — публичное сообщение без адресата. */
export const CHAT_RECIPIENT_EVERYONE = "";

/** Разумный потолок длины id получателя (cuid — 25 символов). */
export const CHAT_RECIPIENT_ID_MAX_LENGTH = 64;

/**
 * Значение-заглушка для фильтра «не показывать ничего» (см. `chatVisibilityWhere`).
 * Не похоже ни на один cuid, поэтому не совпадёт ни с одной строкой в базе.
 */
export const NOTHING_MATCHES_RECIPIENT_ID = "__no_viewer__";

/** Сообщение с точки зрения видимости: кто отправил и кому адресовано. */
export interface ChatVisibility {
  /** Автор сообщения. */
  userId: string;
  /** Получатель приватного сообщения; `null` — сообщение публичное. */
  recipientId: string | null;
}

export type RecipientResolution =
  | { ok: true; recipientId: string | null }
  | { ok: false; code: "BAD_RECIPIENT" | "SELF_RECIPIENT"; error: string };

/**
 * Приводит значение адресата из формы/сокета к `recipientId`.
 *
 * `null` (или пустая строка «Всем») — публичное сообщение. Всё, что не похоже на
 * корректный id, отклоняется: сервер не должен сохранять сообщение с мусорным
 * адресатом, иначе его никто не увидит.
 */
export function resolveRecipientId(raw: unknown, selfUserId: string): RecipientResolution {
  if (raw === null || raw === undefined) return { ok: true, recipientId: null };
  if (typeof raw !== "string") {
    return { ok: false, code: "BAD_RECIPIENT", error: "Некорректный получатель сообщения" };
  }

  const recipientId = raw.trim();
  if (recipientId === CHAT_RECIPIENT_EVERYONE) return { ok: true, recipientId: null };
  if (recipientId.length > CHAT_RECIPIENT_ID_MAX_LENGTH) {
    return { ok: false, code: "BAD_RECIPIENT", error: "Некорректный получатель сообщения" };
  }
  if (recipientId === selfUserId) {
    return { ok: false, code: "SELF_RECIPIENT", error: "Нельзя отправить приватное сообщение самому себе" };
  }

  return { ok: true, recipientId };
}

/**
 * Видит ли зритель сообщение.
 *
 * Публичное видно всем; приватное — только получателю и автору (автору нужно,
 * чтобы его собственное сообщение осталось в ленте и в истории после перезахода).
 */
export function canViewChatMessage(message: ChatVisibility, viewerUserId: string): boolean {
  if (!viewerUserId) return false;
  if (message.recipientId === null) return true;
  return message.recipientId === viewerUserId || message.userId === viewerUserId;
}

/**
 * То же, что `canViewChatMessage`, но для конверта сообщения из
 * `src/lib/realtime.ts`. Связь структурная: модуль остаётся без импортов
 * серверных типов и подходит для проверки и истории, и live-событий.
 */
export function canViewChatEnvelope(
  envelope: { author: { userId: string }; recipient: { userId: string } | null },
  viewerUserId: string,
): boolean {
  return canViewChatMessage(
    { userId: envelope.author.userId, recipientId: envelope.recipient?.userId ?? null },
    viewerUserId,
  );
}

/**
 * OR-условия выборки истории чата для конкретного зрителя — ровно то, что
 * допускает `canViewChatMessage`. Условия готовы к подстановке в Prisma
 * (`where: { meetingId, OR: chatVisibilityWhere(userId) }`), но сам модуль от
 * Prisma не зависит. Порядок совпадает с ТЗ: публичные → полученные приватно →
 * отправленные мной приватно.
 */
export function chatVisibilityWhere(
  viewerUserId: string,
): Array<{ recipientId: null } | { recipientId: string } | { userId: string }> {
  /*
   * Fail closed: без идентификатора зрителя не отдаём ничего — ровно как
   * `canViewChatMessage`. Значение-заглушка не совпадёт ни с одной записью:
   * реальные id — это cuid, а публичные сообщения хранят `null`.
   */
  if (!viewerUserId) return [{ recipientId: NOTHING_MATCHES_RECIPIENT_ID }];
  return [{ recipientId: null }, { recipientId: viewerUserId }, { userId: viewerUserId }];
}

/**
 * Кому можно закреплять (и откреплять) сообщение урока.
 *
 * Плашка закреплённого сообщения видна всей комнате, поэтому управляет ею
 * только учитель или администратор: иначе любой участник мог бы «рассказать»
 * комнате чужое приватное сообщение. Сервер проверяет то же правило
 * (`src/server/realtime.ts`), клиент — чтобы не показывать лишние кнопки.
 */
export function canPinChatMessage(role: Role): boolean {
  return role === "TEACHER" || role === "ADMIN";
}

/** Подпись приватного сообщения в ленте: «Приватно для …» / «Приватно от …». */
export function describePrivateMessage(params: { isMine: boolean; counterpartName: string }): string {
  const name = params.counterpartName.trim() || "участника";
  return params.isMine ? `Приватно для ${name}` : `Приватно от ${name}`;
}
