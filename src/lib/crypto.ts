/**
 * Шифрование сообщений чата: AES-256 (crypto-js).
 *
 * Схема (encrypt-then-MAC):
 *   1. Из ключа комнаты выводим два 256-битных подключа через HMAC-SHA256:
 *      encKey = HMAC(key, "schoolmeet/enc"), macKey = HMAC(key, "schoolmeet/mac").
 *   2. Сообщение шифруем AES-256-CBC с новым случайным IV (16 байт).
 *   3. Поверх шифротекста считаем HMAC-SHA256 — неверный ключ или подмена
 *      данных обнаруживаются до расшифровки.
 *
 * Формат строки: `v1.<iv base64>.<ciphertext base64>.<mac base64>`.
 *
 * Сервер хранит и пересылает только эту строку. Ключ комнаты (`Meeting.encryptionKey`)
 * выдаётся клиенту только после входа в систему.
 */

import CryptoJS from "crypto-js";

const FORMAT_VERSION = "v1";
const ENC_LABEL = "schoolmeet/enc";
const MAC_LABEL = "schoolmeet/mac";
const HEX_KEY_REGEX = /^[0-9a-fA-F]{64}$/;

export class CryptoFormatError extends Error {
  constructor(message = "Не удалось расшифровать сообщение") {
    super(message);
    this.name = "CryptoFormatError";
  }
}

interface DerivedKeys {
  encKey: CryptoJS.lib.WordArray;
  macKey: CryptoJS.lib.WordArray;
}

const keyCache = new Map<string, DerivedKeys>();

/**
 * Ключ комнаты: 64 hex-символа (256 бит) используются как есть. Любая другая
 * строка сначала сворачивается в 256 бит через SHA-256 — так ключ всегда AES-256.
 */
function deriveKeys(roomKey: string): DerivedKeys {
  const cached = keyCache.get(roomKey);
  if (cached) return cached;

  const master = HEX_KEY_REGEX.test(roomKey)
    ? CryptoJS.enc.Hex.parse(roomKey)
    : CryptoJS.SHA256(roomKey);

  const keys: DerivedKeys = {
    encKey: CryptoJS.HmacSHA256(ENC_LABEL, master),
    macKey: CryptoJS.HmacSHA256(MAC_LABEL, master),
  };

  // Кэш небольшой: ключей на вкладку обычно один (ключ текущей комнаты).
  if (keyCache.size > 16) keyCache.clear();
  keyCache.set(roomKey, keys);
  return keys;
}

/** Сравнение строк за постоянное время — чтобы не отдавать длину совпадения. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Шифрует текст сообщения ключом комнаты. Возвращает строку для отправки по сети. */
export function encryptMessage(plaintext: string, roomKey: string): string {
  const { encKey, macKey } = deriveKeys(roomKey);
  const iv = CryptoJS.lib.WordArray.random(16);

  const encrypted = CryptoJS.AES.encrypt(plaintext, encKey, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  const body = [
    FORMAT_VERSION,
    iv.toString(CryptoJS.enc.Base64),
    encrypted.ciphertext.toString(CryptoJS.enc.Base64),
  ].join(".");

  const mac = CryptoJS.HmacSHA256(body, macKey).toString(CryptoJS.enc.Base64);
  return `${body}.${mac}`;
}

/**
 * Расшифровывает строку, созданную `encryptMessage`.
 * Бросает `CryptoFormatError`, если формат неверный, ключ не подходит или
 * данные повреждены — вызывающий код покажет «не удалось расшифровать».
 */
export function decryptMessage(payload: string, roomKey: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new CryptoFormatError();
  }

  const [version, ivB64, ctB64, macB64] = parts;
  const { encKey, macKey } = deriveKeys(roomKey);

  const expectedMac = CryptoJS.HmacSHA256(`${version}.${ivB64}.${ctB64}`, macKey).toString(
    CryptoJS.enc.Base64,
  );
  if (!constantTimeEquals(expectedMac, macB64)) {
    throw new CryptoFormatError();
  }

  try {
    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(ctB64) } as CryptoJS.lib.CipherParams,
      encKey,
      {
        iv: CryptoJS.enc.Base64.parse(ivB64),
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      },
    );
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch {
    throw new CryptoFormatError();
  }
}
