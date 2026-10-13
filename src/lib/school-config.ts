/** Schools provisioned by the application/Prisma seed. Codes are stored exactly as written. */
export const CONFIGURED_SCHOOLS = [
  { name: "Лицей Сингулярити", code: "Sinlycem26" },
  { name: "Fullhouse Teem  ", code: "Fulhouseteem26" },
  { name: "Школа Душа", code: "Anna.Terentieva77" },
] as const;

export const DEFAULT_SCHOOL = CONFIGURED_SCHOOLS[0];

/**
 * Предустановленные admin-токены приглашений для наших школ.
 *
 * Задаются в сиде (`prisma/seed.ts`) и авто-инициализации школ
 * (`provisionConfiguredSchools`): админ-ссылка каждой школы детерминирована
 * (`/auth/register?code=…&invite=admin-…`). Токены учителей генерируются
 * случайно приложением (`@/lib/invite-tokens`) и выдаются только через
 * админ-панель — в БД обе колонки nullable, default на уровне PostgreSQL у них
 * отсутствует (иначе `prisma db push` не проходил бы на непустой таблице).
 */
export const CONFIGURED_ADMIN_INVITE_TOKENS: Readonly<Record<string, string>> = {
  Sinlycem26: "admin-sinlycem-2026",
  Fulhouseteem26: "admin-fulhouse-2026",
  "Anna.Terentieva77": "admin-annat-2026",
};

/** Предустановленный admin-токен школы (по коду, без учёта регистра) или undefined. */
export function configuredAdminInviteToken(code: string): string | undefined {
  const needle = code.trim().toLowerCase();
  for (const [key, token] of Object.entries(CONFIGURED_ADMIN_INVITE_TOKENS)) {
    if (key.toLowerCase() === needle) return token;
  }
  return undefined;
}

/** The old single-tenant demo code is migrated into the primary school. */
export const LEGACY_DEFAULT_SCHOOL_CODE = "SCHOOL1";

const DEFAULT_CLASS_LETTERS = ["А", "Б"] as const;

/** The default groups created for every provisioned school (5-А … 11-Б). */
export const DEFAULT_CLASS_NAMES = [5, 6, 7, 8, 9, 10, 11].flatMap((grade) =>
  DEFAULT_CLASS_LETTERS.map((letter) => `${grade}-${letter}`),
);
