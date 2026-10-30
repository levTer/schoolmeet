/**
 * TOTP (RFC 6238) и резервные коды — без внешних библиотек и сервисов.
 *
 * Почему свой код, а не npm-пакет: алгоритм крошечный (HMAC-SHA1 по счётчику),
 * а каждая зависимость в цепочке аутентификации — это ещё один потенциальный
 * supply-chain риск. Здесь используется только `node:crypto`.
 *
 * Параметры — стандартные, совместимые с Google Authenticator, Aegis, 1Password
 * и любым другим TOTP-приложением: SHA-1, 6 цифр, шаг 30 секунд.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** Шаг времени TOTP: 30 секунд, как в RFC 6238 и во всех приложениях. */
export const TOTP_STEP_SECONDS = 30;
/** Сколько цифр показываем: 6 — стандарт совместимости. */
export const TOTP_DIGITS = 6;
/** Допуск по времени: ±1 шаг (часы телефона редко идут идеально). */
export const TOTP_WINDOW = 1;
/** Сколько резервных кодов выдаём при включении 2FA. */
export const BACKUP_CODE_COUNT = 10;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Кодирует байты в Base32 (RFC 4648, верхний регистр, без выравнивающих `=`). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let index = 0; index < bytes.length; index += 1) {
    value = (value << 8) | bytes[index];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/**
 * Декодирует Base32. Пробелы, дефисы и регистр игнорируются — секрет часто
 * вводят руками с экрана, и это не должно ломать вход.
 */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Некорректный символ Base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/** Новый секрет: 160 бит энтропии (20 байт) — рекомендация RFC 4226. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP из RFC 4226: HMAC-SHA1 по счётчику, динамическое усечение. */
export function hotp(secret: string, counter: number, digits = TOTP_DIGITS): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Номер текущего шага TOTP для момента времени (мс). */
export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/** Код TOTP, действующий в указанный момент. */
export function totp(secret: string, nowMs: number = Date.now(), digits = TOTP_DIGITS): string {
  return hotp(secret, totpStep(nowMs), digits);
}

/**
 * Проверяет код TOTP с допуском по времени.
 *
 * Возвращает номер совпавшего шага (нужен для защиты от повторного
 * использования кода) или `null`. Сравнение — постоянное по времени.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { nowMs?: number; window?: number; digits?: number } = {},
): number | null {
  const digits = options.digits ?? TOTP_DIGITS;
  const window = options.window ?? TOTP_WINDOW;
  const normalized = (code ?? "").replace(/\D/g, "");
  if (normalized.length !== digits) return null;

  const currentStep = totpStep(options.nowMs ?? Date.now());

  for (let offset = -window; offset <= window; offset += 1) {
    const step = currentStep + offset;
    if (step < 0) continue;
    const expected = hotp(secret, step, digits);
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(normalized, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) return step;
  }

  return null;
}

/** `otpauth://`-ссылка: её понимают все приложения-аутентификаторы. */
export function otpauthUri(options: {
  secret: string;
  account: string;
  issuer?: string;
  digits?: number;
  period?: number;
}): string {
  const issuer = options.issuer ?? "EduFlow";
  const digits = options.digits ?? TOTP_DIGITS;
  const period = options.period ?? TOTP_STEP_SECONDS;
  const label = `${issuer}:${options.account}`;
  const params = new URLSearchParams({
    secret: options.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/** Резервный код: 10 символов из алфавита без похожих друг на друга. */
const BACKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let code = "";
    for (let index = 0; index < 10; index += 1) {
      code += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
    }
    codes.add(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return [...codes];
}

/**
 * Хеш резервного кода для хранения.
 *
 * Здесь достаточно SHA-256 (а не bcrypt): коды случайные, 50 бит энтропии,
 * перебирать их по хешу невыгодно, а фиксированная стоимость сравнения важна,
 * когда пользователь вводит код при входе.
 */
export function hashBackupCode(code: string): string {
  const normalized = normalizeBackupCode(code);
  return createHash("sha256").update(`eduflow-backup-v1:${normalized}`).digest("hex");
}

/** Приводит ввод к каноническому виду: без пробелов, дефисов и регистра. */
export function normalizeBackupCode(code: string): string {
  return (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
