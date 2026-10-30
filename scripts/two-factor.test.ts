/**
 * Тесты двухфакторной аутентификации (TOTP + резервные коды).
 *
 * Запуск: `npm run test:2fa` (входит в `npm test`). Сеть и БД не нужны:
 * проверяется чистая криптография по официальным тест-векторам RFC 6238
 * и контракты исходников (порядок проверок во входе, аудит, миграция).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { constantTimeEqual, openSecret, sealSecret } from "../src/lib/secret-box";
import {
  BACKUP_CODE_COUNT,
  base32Decode,
  base32Encode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  hotp,
  normalizeBackupCode,
  otpauthUri,
  totp,
  totpStep,
  verifyTotp,
} from "../src/lib/totp";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

process.env.NEXTAUTH_SECRET = "two-factor-test-secret-not-a-real-one";

/* -------------------------------------------------------------------------- */
/* 1. TOTP по официальным тест-векторам RFC 6238 (SHA-1, 8 цифр)              */
/* -------------------------------------------------------------------------- */

describe("TOTP: тест-векторы RFC 6238", () => {
  // Секрет из приложения B RFC: ASCII "12345678901234567890".
  const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

  const vectors: Array<{ time: number; code: string }> = [
    { time: 59, code: "94287082" },
    { time: 1111111109, code: "07081804" },
    { time: 1111111111, code: "14050471" },
    { time: 1234567890, code: "89005924" },
    { time: 2000000000, code: "69279037" },
    { time: 20000000000, code: "65353130" },
  ];

  for (const vector of vectors) {
    it(`T=${vector.time} → ${vector.code}`, () => {
      assert.equal(totp(RFC_SECRET, vector.time * 1000, 8), vector.code);
    });
  }

  it("код из 6 цифр — это те же 6 младших цифр", () => {
    assert.equal(totp(RFC_SECRET, 59 * 1000, 6), "287082");
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Base32                                                                  */
/* -------------------------------------------------------------------------- */

describe("Base32", () => {
  it("кодирует и декодирует без потерь", () => {
    const bytes = Buffer.from("EduFlow-TOTP-secret", "utf8");
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  });

  it("секрет из 20 байт даёт 32 символа Base32", () => {
    const secret = generateTotpSecret();
    assert.equal(secret.length, 32);
    assert.equal(base32Decode(secret).length, 20);
  });

  it("принимает секрет с пробелами, дефисами и в нижнем регистре", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const messy = "jbsw y3dp-ehpk 3pxp";
    assert.deepEqual(base32Decode(messy), base32Decode(secret));
  });

  it("отвергает символы вне алфавита", () => {
    assert.throws(() => base32Decode("JBSWY3DPEHPK3PX1"), /Base32/);
  });

  it("два секрета не совпадают", () => {
    assert.notEqual(generateTotpSecret(), generateTotpSecret());
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Проверка кода: окно, отказ, повтор                                     */
/* -------------------------------------------------------------------------- */

describe("проверка TOTP-кода", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;

  it("принимает текущий код и возвращает номер шага", () => {
    assert.equal(verifyTotp(secret, totp(secret, now), { nowMs: now }), totpStep(now));
  });

  it("принимает код предыдущего и следующего шага (±30 секунд)", () => {
    assert.notEqual(verifyTotp(secret, totp(secret, now - 30_000), { nowMs: now }), null);
    assert.notEqual(verifyTotp(secret, totp(secret, now + 30_000), { nowMs: now }), null);
  });

  it("отвергает код за пределами окна", () => {
    assert.equal(verifyTotp(secret, totp(secret, now - 120_000), { nowMs: now }), null);
  });

  it("отвергает мусор и неверную длину", () => {
    assert.equal(verifyTotp(secret, "", { nowMs: now }), null);
    assert.equal(verifyTotp(secret, "12345", { nowMs: now }), null);
    assert.equal(verifyTotp(secret, "abcdef", { nowMs: now }), null);
  });

  it("номер шага растёт со временем — значит, повтор кода можно отсечь", () => {
    const first = verifyTotp(secret, totp(secret, now), { nowMs: now });
    const next = verifyTotp(secret, totp(secret, now + 30_000), { nowMs: now + 30_000 });
    assert.notEqual(first, null);
    assert.notEqual(next, null);
    assert.ok((next as number) > (first as number));
  });

  it("HOTP совпадает с известным вектором RFC 4226", () => {
    // Приложение D RFC 4226: секрет "12345678901234567890", счётчик 0.
    const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
    assert.equal(hotp(secret, 0, 6), "755224");
    assert.equal(hotp(secret, 1, 6), "287082");
  });
});

/* -------------------------------------------------------------------------- */
/* 4. otpauth-ссылка                                                          */
/* -------------------------------------------------------------------------- */

describe("otpauth-ссылка", () => {
  it("содержит секрет, издателя, алгоритм и период", () => {
    const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "teacher@school.ru" });
    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
    assert.match(uri, /issuer=EduFlow/);
    assert.match(uri, /algorithm=SHA1/);
    assert.match(uri, /period=30/);
    assert.match(uri, /teacher%40school\.ru/);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Резервные коды                                                          */
/* -------------------------------------------------------------------------- */

describe("резервные коды", () => {
  it("выдаются в нужном количестве, без повторов", () => {
    const codes = generateBackupCodes();
    assert.equal(codes.length, BACKUP_CODE_COUNT);
    assert.equal(new Set(codes).size, BACKUP_CODE_COUNT);
  });

  it("формат XXXXX-XXXXX из однозначных символов", () => {
    for (const code of generateBackupCodes()) {
      assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      assert.doesNotMatch(code, /[01OI]/);
    }
  });

  it("хеш детерминирован и не зависит от регистра и дефиса", () => {
    assert.equal(hashBackupCode("ABCDE-23456"), hashBackupCode("abcde 23 456"));
  });

  it("разные коды дают разные хеши", () => {
    const [first, second] = generateBackupCodes(2);
    assert.notEqual(hashBackupCode(first), hashBackupCode(second));
  });

  it("нормализация убирает всё, кроме латиницы и цифр", () => {
    assert.equal(normalizeBackupCode(" ab-cd e "), "ABCDE");
  });

  it("хеш не содержит исходный код", () => {
    const code = "ABCDE-23456";
    assert.ok(!hashBackupCode(code).includes(normalizeBackupCode(code)));
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Шифрование секрета при хранении                                        */
/* -------------------------------------------------------------------------- */

describe("шифрование секрета (AES-256-GCM)", () => {
  it("расшифровка возвращает исходный секрет", () => {
    const secret = generateTotpSecret();
    assert.equal(openSecret(sealSecret(secret)), secret);
  });

  it("одинаковые секреты дают разные шифротексты (свой IV)", () => {
    assert.notEqual(sealSecret("SAME"), sealSecret("SAME"));
  });

  it("шифротекст не содержит секрет открытым текстом", () => {
    const sealed = sealSecret("JBSWY3DPEHPK3PXP");
    assert.ok(!sealed.includes("JBSWY3DPEHPK3PXP"));
  });

  it("подмена байта обнаруживается", () => {
    const sealed = sealSecret("JBSWY3DPEHPK3PXP");
    const parts = sealed.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("другой", "utf8").toString("base64url")].join(".");
    assert.throws(() => openSecret(tampered));
  });

  it("чужая версия формата отвергается", () => {
    assert.throws(() => openSecret("v2.a.b.c"));
  });

  it("без NEXTAUTH_SECRET шифрование не работает (fail-closed)", () => {
    const saved = process.env.NEXTAUTH_SECRET;
    try {
      delete process.env.NEXTAUTH_SECRET;
      assert.throws(() => sealSecret("x"), /NEXTAUTH_SECRET/);
    } finally {
      process.env.NEXTAUTH_SECRET = saved;
    }
  });
});

describe("сравнение без утечки времени", () => {
  it("совпадающие строки — true, разные — false, разная длина — false", () => {
    assert.equal(constantTimeEqual("abc", "abc"), true);
    assert.equal(constantTimeEqual("abc", "abd"), false);
    assert.equal(constantTimeEqual("abc", "abcd"), false);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Контракты приложения                                                    */
/* -------------------------------------------------------------------------- */

describe("второй фактор встроен во вход и не обходится", () => {
  it("auth.ts проверяет второй фактор ДО сброса счётчика провалов", () => {
    const auth = readSource("src/lib/auth.ts");
    const check = auth.indexOf("verifySecondFactor(user");
    const reset = auth.indexOf("resetLoginFailures(cleanEmail)");
    assert.ok(check > -1, "вход не проверяет второй фактор");
    assert.ok(reset > -1, "сброс счётчика провалов пропал");
    assert.ok(check < reset, "счётчик сбрасывается до проверки второго фактора");
  });

  it("неверный второй фактор считается неудачной попыткой входа", () => {
    const auth = readSource("src/lib/auth.ts");
    const twoFactorBlock = auth.slice(auth.indexOf("if (isTwoFactorEnabled(user))"));
    const body = twoFactorBlock.slice(0, twoFactorBlock.indexOf("// Успешный вход"));
    assert.match(body, /registerLoginFailure\(cleanEmail\)/, "код можно перебирать без ограничений");
  });

  it("проверка кода при входе не выдаёт сессию", () => {
    const route = readSource("src/app/api/auth/2fa/check/route.ts");
    assert.ok(!/getServerSession|signIn|jwt\(/.test(route), "endpoint не должен выпускать сессию");
    assert.match(route, /registerLoginFailure/, "неудачная проверка пароля не считается провалом");
    assert.match(route, /DUMMY_HASH/, "нет выравнивания времени для несуществующего аккаунта");
  });

  it("включение и выключение 2FA требуют пароль", () => {
    const route = readSource("src/app/api/account/2fa/route.ts");
    const posts = route.match(/verifyPassword\(viewer\.id/g) ?? [];
    assert.ok(posts.length >= 2, "пароль не проверяется при включении и выключении");
  });

  it("администратор снимает 2FA только со своей школы и с записью в аудит", () => {
    const route = readSource("src/app/api/admin/users/[id]/2fa/route.ts");
    assert.match(route, /requireAdminViewer/);
    assert.match(route, /getUserForAdmin\(id, viewer\.schoolId\)/);
    assert.match(route, /user\.2fa\.reset/);
  });

  it("вход спрашивает, нужен ли код, до отправки пароля в NextAuth", () => {
    const form = readSource("src/components/auth/login-form.tsx");
    const check = form.indexOf("/api/auth/2fa/check");
    const signIn = form.indexOf('signIn("credentials"');
    assert.ok(check > -1, "форма не различает аккаунты с 2FA");
    assert.ok(check < signIn, "код запрашивается после отправки пароля");
  });

  it("страница безопасности защищена сессией и прокси", () => {
    const page = readSource("src/app/account/security/page.tsx");
    assert.match(page, /getServerSession/);
    assert.match(page, /redirect\("\/login/);
    const proxy = readSource("src/proxy.ts");
    assert.match(proxy, /"\/account"/);
    assert.match(proxy, /"\/api\/account"/);
  });

  it("миграция добавляет колонки 2FA и не трогает существующие данные", () => {
    const sql = readSource("prisma/migrations/20261030130000_user_two_factor/migration.sql");
    assert.match(sql, /ADD COLUMN "twoFactorSecret" TEXT/);
    assert.match(sql, /ADD COLUMN "twoFactorEnabledAt"/);
    assert.match(sql, /ADD COLUMN "twoFactorBackupCodes" TEXT\[\]/);
    assert.match(sql, /ADD COLUMN "twoFactorLastStep"/);
    assert.doesNotMatch(sql, /DROP|TRUNCATE|DELETE/, "миграция не должна удалять данные");
  });

  it("секрет в БД не хранится в открытом виде", () => {
    const service = readSource("src/lib/two-factor.ts");
    assert.match(service, /sealSecret\(secret\)/);
    assert.match(service, /openSecret\(user\.twoFactorSecret\)/);
    assert.doesNotMatch(service, /twoFactorSecret: secret\b/, "секрет пишется как есть");
  });
});
