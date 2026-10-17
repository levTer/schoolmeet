/**
 * Настроенные школы, их секреты приглашений и гарантированные демо-админы.
 *
 * ⚠️ Значения ниже — ДЕМО-значения для публичного репозитория. Любой, у кого
 * есть доступ к исходникам, знает их, поэтому в продуктиве их надо переопределить
 * переменными окружения (см. `SCHOOLMEET_ADMIN_INVITE_TOKENS` и
 * `SCHOOLMEET_DEMO_ADMIN_PASSWORDS` в `.env.example`).
 *
 * Модуль целиком серверный: он НЕ импортируется клиентскими компонентами,
 * поэтому токены приглашений и пароли не попадают в браузерный бандл
 * (проверяется тестом `scripts/security-rules.test.ts`).
 */

/** Карта «код школы → токен» из переменной окружения (приоритет над литералами). */
function readSecretMap(rawValue: string | undefined): Record<string, string> {
  if (!rawValue) return {};
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) map[key.trim().toLowerCase()] = value.trim();
    }
    return map;
  } catch (error) {
    console.error("[school-config] Не удалось разобрать карту секретов из окружения:", error);
    return {};
  }
}

/** Пригласительные токены администраторов из окружения: `{"Sinlycem26": "…"}`. */
function envAdminInviteTokens(): Record<string, string> {
  return readSecretMap(process.env.SCHOOLMEET_ADMIN_INVITE_TOKENS);
}

/** Пароли гарантированных администраторов из окружения: `{"admin@…": "…"}`. */
function envAdminPasswords(): Record<string, string> {
  return readSecretMap(process.env.SCHOOLMEET_DEMO_ADMIN_PASSWORDS);
}

/** Выключена ли инициализация гарантированных демо-админов (`"true"` — выключена). */
export function demoAdminSeedDisabled(): boolean {
  return (process.env.SCHOOLMEET_DISABLE_DEMO_ADMIN_SEED ?? "").trim().toLowerCase() === "true";
}

/**
 * Разрешён ли принудительный возврат демо-паролей при старте.
 *
 * По умолчанию ВЫКЛЮЧЕН: иначе смена пароля администратором отменялась бы
 * следующим запуском сервера (находка C-02). Включается оператором на один
 * запуск (`SCHOOLMEET_RESET_DEMO_ADMIN_PASSWORDS=true`), когда демо-доступ надо
 * восстановить.
 */
export function demoAdminPasswordResetEnabled(): boolean {
  return (process.env.SCHOOLMEET_RESET_DEMO_ADMIN_PASSWORDS ?? "").trim().toLowerCase() === "true";
}

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

/**
 * Предустановленный admin-токен школы (по коду, без учёта регистра) или undefined.
 *
 * Сначала ищем значение в окружении (`SCHOOLMEET_ADMIN_INVITE_TOKENS`) — так
 * продуктив получает свой секрет, не публикуя его в репозитории. Литералы ниже
 * остаются демо-значениями «из коробки» (и используются тестами).
 */
export function configuredAdminInviteToken(code: string): string | undefined {
  const needle = code.trim().toLowerCase();
  const fromEnv = envAdminInviteTokens()[needle];
  if (fromEnv) return fromEnv;

  for (const [key, token] of Object.entries(CONFIGURED_ADMIN_INVITE_TOKENS)) {
    if (key.toLowerCase() === needle) return token;
  }
  return undefined;
}

/**
 * Гарантированные демо-администраторы всех настроенных школ.
 *
 * Роль ADMIN нельзя получить через публичную форму регистрации (см. PUBLIC_ROLES),
 * поэтому аккаунты создаются приложением вместе со школами —
 * `provisionConfiguredSchools` в `@/lib/schools` (при старте `server.ts` и в
 * сиде). Это страховка для свежего деплоя или пустой базы без сида: вход в
 * `/admin` доступен в каждой из трёх школ сразу.
 *
 * Пароль xешируется bcrypt при СОЗДАНИИ аккаунта; у уже существующего
 * аккаунта пароль НЕ перетирается (иначе смена пароля администратором
 * отменялась бы следующим стартом — находка C-02). Принудительный возврат
 * демо-паролей — только по `SCHOOLMEET_RESET_DEMO_ADMIN_PASSWORDS=true`.
 *
 * Сами пароли можно переопределить через `SCHOOLMEET_DEMO_ADMIN_PASSWORDS`
 * (JSON `{"admin@schoolmeet.ru": "…"}`); в логах пароли не печатаются.
 */
const DEMO_ADMIN_DEFINITIONS = [
  {
    email: "admin@schoolmeet.ru",
    password: "Admin123!",
    name: "Администратор Лицея Сингулярити",
    role: "ADMIN",
    schoolCode: "Sinlycem26",
  },
  {
    email: "fullhouse@schoolmeet.ru",
    password: "Fullhouse123!",
    name: "Администратор Fullhouse",
    role: "ADMIN",
    schoolCode: "Fulhouseteem26",
  },
  {
    email: "anna@schoolmeet.ru",
    password: "Anna123!",
    name: "Анна Терентьева",
    role: "ADMIN",
    schoolCode: "Anna.Terentieva77",
  },
] as const;

export const GUARANTEED_ADMINS = DEMO_ADMIN_DEFINITIONS.map((admin) => ({
  ...admin,
  password: envAdminPasswords()[admin.email.toLowerCase()] ?? admin.password,
}));

/** Обратная совместимость для кода и документации, которым нужен основной админ. */
export const GUARANTEED_ADMIN = GUARANTEED_ADMINS[0];

/** The old single-tenant demo code is migrated into the primary school. */
export const LEGACY_DEFAULT_SCHOOL_CODE = "SCHOOL1";

const DEFAULT_CLASS_LETTERS = ["А", "Б"] as const;

/** The default groups created for every provisioned school (5-А … 11-Б). */
export const DEFAULT_CLASS_NAMES = [5, 6, 7, 8, 9, 10, 11].flatMap((grade) =>
  DEFAULT_CLASS_LETTERS.map((letter) => `${grade}-${letter}`),
);
