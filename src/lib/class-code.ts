/**
 * Коды классов и разовый допуск в чужой класс строгих школ.
 *
 * Школа с `strictClassIsolation = true` пускает ученика только в уроки своего
 * класса. Чтобы попасть на урок другого класса (например, смена или
 * подготовка), ученик вводит КОД КЛАССА (`Class.code`, видят учителя и
 * администрация). Сервер проверяет код и выдаёт подписанный ОДНОРАЗОВЫЙ
 * допуск (`class code grant`) — HMAC-SHA256, привязанный к конкретному
 * пользователю, классу и комнате урока, живёт `CLASS_CODE_GRANT_TTL_MS`.
 *
 * Модуль чистый (node:crypto, без Prisma) — покрывается юнит-тестами
 * (`scripts/security-rules.test.ts`) и используется в:
 *  - `src/lib/schools.ts` (`backfillClassCodes` — генерация кодов);
 *  - `src/app/api/meetings/[code]/class-access/route.ts` (проверка кода → grant);
 *  - `src/lib/meetings.ts` (`checkMeetingAccess` — приём grant в доступ).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { randomCodeSuffix } from "@/lib/lesson-code";

/** Как долго живёт разовый допуск по коду класса (час — хватит на урок). */
export const CLASS_CODE_GRANT_TTL_MS = 60 * 60 * 1000;

/** Секрет подписи: общий с NextAuth, отдельный фолбэк только для dev. */
export function classCodeGrantSecret(): string {
  return process.env.NEXTAUTH_SECRET || "schoolmeet-class-code-dev-secret";
}

/** Кириллица → латиница для кода класса («5-Б» → «5B»). */
const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g",
};

/**
 * Код класса для приглашений: «название (латиницей) + 5 криптослучайных
 * символов», например «5-Б» → `5B-K7QZM4`. Криптостойкий алфавит без
 * неоднозначных символов (0/O, 1/I/L) — см. `randomCodeSuffix`. Код всегда
 * ASCII: вводить его на любой раскладке должно быть одинаково легко.
 */
export function generateClassCode(className: string): string {
  const transliterated = Array.from(className)
    .map((char) => {
      const lower = char.toLowerCase();
      return CYRILLIC_TO_LATIN[lower] ?? char;
    })
    .join("");
  const base = transliterated.replace(/[^0-9A-Za-z]/g, "").slice(0, 8).toUpperCase() || "CLASS";
  return `${base}-${randomCodeSuffix(5).toUpperCase()}`;
}

/** Нормализация кода класса при вводе: пробелы, регистр. */
export function normalizeClassCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/** Что подписано внутри grant: кому, в какой класс и комнату, когда. */
export interface ClassCodeGrantPayload {
  userId: string;
  classId: string;
  schoolId: string;
  meetingCode: string;
  issuedAt: number;
}

const GRANT_VERSION = "v1";

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function hmacBase64Url(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "base64url");
  const rightBuffer = Buffer.from(right, "base64url");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Подписывает допуск: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`.
 * HMAC считается над «версия + payload» — переписать поле и не сломать
 * подпись нельзя.
 */
export function signClassCodeGrant(payload: ClassCodeGrantPayload, secret: string): string {
  const body = toBase64Url(JSON.stringify(payload));
  return `${GRANT_VERSION}.${body}.${hmacBase64Url(`${GRANT_VERSION}.${body}`, secret)}`;
}

/**
 * Проверяет допуск и его привязку: подпись, срок жизни, и что grant именно
 * для этого пользователя, класса и комнаты урока. Любой сбой — `false`
 * (fail-closed: битый токен не даёт доступ).
 */
export function verifyClassCodeGrant(
  token: string,
  secret: string,
  expected: { userId: string; classId: string; meetingCode: string },
  options: { now?: number; ttlMs?: number } = {},
): boolean {
  if (typeof token !== "string" || token.length > 4096) return false;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== GRANT_VERSION) return false;

  const [version, body, signature] = parts;
  if (!safeEqual(hmacBase64Url(`${version}.${body}`, secret), signature)) return false;

  let payload: ClassCodeGrantPayload;
  try {
    payload = JSON.parse(fromBase64Url(body)) as ClassCodeGrantPayload;
  } catch {
    return false;
  }

  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? CLASS_CODE_GRANT_TTL_MS;
  if (typeof payload.issuedAt !== "number") return false;
  if (payload.issuedAt > now + 60_000) return false; // «из будущего» — часы сбились
  if (now - payload.issuedAt > ttlMs) return false;

  return (
    payload.userId === expected.userId &&
    payload.classId === expected.classId &&
    payload.meetingCode === expected.meetingCode
  );
}
