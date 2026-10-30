-- Двухфакторная аутентификация (TOTP, RFC 6238).
--
-- Секрет хранится в зашифрованном виде (AES-256-GCM, ключ выводится из
-- NEXTAUTH_SECRET), резервные коды — только как SHA-256 хеши. Включённой
-- 2FA считается при заполненном "twoFactorEnabledAt": до подтверждения кода
-- секрет остаётся черновиком настройки.

ALTER TABLE "users"
  ADD COLUMN "twoFactorSecret" TEXT,
  ADD COLUMN "twoFactorEnabledAt" TIMESTAMP(3),
  ADD COLUMN "twoFactorBackupCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "twoFactorLastStep" INTEGER;
