/**
 * Шифрование коротких секретов приложения «в покое» (AES-256-GCM).
 *
 * Зачем: секрет TOTP — это фактически второй пароль. Если база утечёт,
 * обычный `SELECT` не должен выдавать рабочие секреты, поэтому в БД лежит
 * шифротекст, а ключ выводится из `NEXTAUTH_SECRET` (scrypt, своя соль).
 *
 * Формат строки: `v1.<iv>.<tag>.<ciphertext>`, все части — base64url.
 * Версия в префиксе позволяет менять схему без миграции данных.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_SALT = "schoolmeet-secret-box-v1";

/** Ключ шифрования, выведенный из `NEXTAUTH_SECRET`. Без секрета — ошибка. */
function encryptionKey(): Buffer {
  const secret = (process.env.NEXTAUTH_SECRET ?? "").trim();
  if (!secret) {
    // Fail-closed: молчаливая работа с пустым ключом сделала бы шифрование
    // декоративным. В production без секрета приложение и так не стартует.
    throw new Error("NEXTAUTH_SECRET не задан: шифрование секретов невозможно");
  }
  return scryptSync(secret, KEY_SALT, 32);
}

/** Шифрует строку. Каждый вызов даёт новый IV, поэтому шифротексты разные. */
export function sealSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/**
 * Расшифровывает строку. Любое отклонение (битая строка, чужая версия,
 * подмена байта) — исключение: подделанный секрет не должен «сработать»
 * частично.
 */
export function openSecret(sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Некорректный формат зашифрованного секрета");
  }

  const [, ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}

/** Сравнение строк без утечки времени (для кодов и хешей). */
export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
