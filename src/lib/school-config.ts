import { randomBytes } from "node:crypto";

import { canonicalSchoolCode } from "@/lib/school-rules";

/**
 * Настроенные школы, их секреты приглашений и bootstrap-админы.
 *
 * ⚠️ Ни один секрет НЕ хранится в репозитории. Репозиторий публичный, поэтому:
 *  - пароли bootstrap-админов приходят только из `SCHOOLMEET_BOOTSTRAP_ADMIN_PASSWORDS`
 *    (legacy-алиас: `SCHOOLMEET_DEMO_ADMIN_PASSWORDS`); если переменной нет,
 *    аккаунт создаётся с криптослучайным одноразовым паролем, который печатается
 *    в лог ровно один раз — при создании (C-01/C-02);
 *  - admin-invite-токены приходят только из `SCHOOLMEET_ADMIN_INVITE_TOKENS`;
 *    если переменной нет, школы получают случайные UUID-токены, а ссылка
 *    администратора видна лишь в админ-панели.
 *
 * Модуль целиком серверный: он НЕ импортируется клиентскими компонентами,
 * поэтому токены приглашений и пароли не попадают в браузерный бандл
 * (проверяется тестом `scripts/security-rules.test.ts`).
 */

/** Карта «ключ → значение» из переменной окружения (приоритет над литералами). */
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

/**
 * Пароли bootstrap-админов из окружения: `{"admin@…": "…"}`.
 * Поддерживается legacy-имя переменной, чтобы существующие деплои не сломались.
 */
function envAdminPasswords(): Record<string, string> {
  return {
    ...readSecretMap(process.env.SCHOOLMEET_DEMO_ADMIN_PASSWORDS),
    ...readSecretMap(process.env.SCHOOLMEET_BOOTSTRAP_ADMIN_PASSWORDS),
  };
}

/** Выключена ли инициализация bootstrap-админов (`"true"` — выключена). */
export function demoAdminSeedDisabled(): boolean {
  const flag = process.env.SCHOOLMEET_DISABLE_DEMO_ADMIN_SEED ?? process.env.SCHOOLMEET_DISABLE_BOOTSTRAP_ADMIN ?? "";
  return flag.trim().toLowerCase() === "true";
}

/**
 * Schools provisioned by the application/Prisma seed. Codes are stored exactly
 * as written.
 *
 * `strictClassIsolation` — политика изоляции классов школы:
 *  - `true`  (STRICT)   — ученик заходит только в уроки своего класса либо с
 *    правильным кодом класса (`Class.code`);
 *  - `false` (FLEXIBLE) — ученик может заходить на любые уроки своей школы.
 *
 * Значение синхронизируется в БД при старте (`provisionConfiguredSchools`),
 * поэтому в проде оно может быть переопределено администратором школы
 * (админ-панель), а provisioning вернёт «настроенное» значение.
 */
export const CONFIGURED_SCHOOLS = [
  { name: "Лицей Сингулярити", code: "Sinlycem26", strictClassIsolation: true },
  { name: "Fullhouse Teem  ", code: "Fulhouseteem26", strictClassIsolation: false },
  { name: "Школа Душа", code: "Anna.Terentieva77", strictClassIsolation: false },
] as const;

export const DEFAULT_SCHOOL = CONFIGURED_SCHOOLS[0];

/**
 * Политика изоляции классов настроенной школы по её коду.
 *
 * `true` — строгая школа (ученик заходит только в уроки своего класса),
 * `false` — гибкая (любые уроки своей школы, класс ученику не обязателен).
 * Неизвестный код считается гибкой школой: без класса доступ шире, чем
 * «никто», а регистрация такого ученика не должна блокироваться.
 */
export function configuredStrictClassIsolation(code: string): boolean {
  const needle = code.trim().toLowerCase();
  return CONFIGURED_SCHOOLS.find((school) => school.code.toLowerCase() === needle)?.strictClassIsolation ?? false;
}

/**
 * Предустановленный admin-токен школы (по коду, без учёта регистра) или undefined.
 *
 * Значение берётся ТОЛЬКО из окружения (`SCHOOLMEET_ADMIN_INVITE_TOKENS`).
 * Литералов в репозитории больше нет: всё, что лежит в публичном коде, не может
 * быть секретом (находки C-01/C-02). Если переменная не задана, вызывающая
 * сторона выпускает случайный UUID (`adminInviteTokenFor` в `@/lib/invite-tokens`).
 */
export function configuredAdminInviteToken(code: string): string | undefined {
  const needle = code.trim().toLowerCase();
  return envAdminInviteTokens()[needle];
}

/**
 * Bootstrap-администраторы настроенных школ.
 *
 * Роль ADMIN нельзя получить через публичную форму регистрации, поэтому при
 * первом запуске на пустой базе приложение создаёт администратора каждой школы.
 * Правила (`ensureGuaranteedAdmin` в `@/lib/schools`):
 *  - аккаунт только СОЗДАЁТСЯ; существующий аккаунт никогда не изменяется
 *    (бан, понижение роли и смена пароля не отменяются рестартом);
 *  - если в школе уже есть хотя бы один ADMIN, bootstrap-аккаунт не создаётся;
 *  - пароль: из `SCHOOLMEET_BOOTSTRAP_ADMIN_PASSWORDS`, иначе криптослучайный
 *    одноразовый, который печатается в лог один раз при создании.
 *
 * В логах не бывает «вечных» паролей: одноразовый пароль печатается только в
 * момент создания аккаунта и должен быть сменён после первого входа.
 */
const BOOTSTRAP_ADMIN_DEFINITIONS = [
  {
    email: "admin@schoolmeet.ru",
    name: "Администратор Лицея Сингулярити",
    role: "ADMIN",
    schoolCode: "Sinlycem26",
  },
  {
    email: "fullhouse@schoolmeet.ru",
    name: "Администратор Fullhouse",
    role: "ADMIN",
    schoolCode: "Fulhouseteem26",
  },
  {
    email: "anna@schoolmeet.ru",
    name: "Анна Терентьева",
    role: "ADMIN",
    schoolCode: "Anna.Terentieva77",
  },
] as const;

export interface BootstrapAdmin {
  email: string;
  name: string;
  role: "ADMIN";
  schoolCode: string;
  /** Пароль из окружения; отсутствует — будет выпущен одноразовый случайный. */
  password?: string;
}

export const GUARANTEED_ADMINS: readonly BootstrapAdmin[] = BOOTSTRAP_ADMIN_DEFINITIONS.map((admin) => {
  const password = envAdminPasswords()[admin.email.toLowerCase()];
  return password ? { ...admin, password } : { ...admin };
});

/** Обратная совместимость для кода и документации, которым нужен основной админ. */
export const GUARANTEED_ADMIN: BootstrapAdmin = GUARANTEED_ADMINS[0];

/**
 * Одноразовый пароль bootstrap-администратора.
 *
 * 24 символа из безопасного алфавита (без похожих `0/O`, `1/l/I`) плюс
 * гарантированные буква, цифра и спецсимвол — такой пароль проходит
 * `getPasswordIssues` из `@/lib/validation`.
 */
export function generateBootstrapPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(20);
  let core = "";
  for (let index = 0; index < bytes.length; index += 1) {
    core += alphabet[bytes[index] % alphabet.length];
  }
  return `Aa1!${core}`;
}

/** The old single-tenant demo code is migrated into the primary school. */
export const LEGACY_DEFAULT_SCHOOL_CODE = "SCHOOL1";

const DEFAULT_CLASS_LETTERS = ["А", "Б"] as const;

/** The default groups created for every provisioned school (5-А … 11-Б). */
export const DEFAULT_CLASS_NAMES = [5, 6, 7, 8, 9, 10, 11].flatMap((grade) =>
  DEFAULT_CLASS_LETTERS.map((letter) => `${grade}-${letter}`),
);

/* -------------------------------------------------------------------------- */
/* Школы с ОДНИМ общим классом                                                */
/* -------------------------------------------------------------------------- */

/**
 * Название единственного класса «одноклассной» школы.
 *
 * Нужно школам без деления на параллели (например, «Школа Душа»): вместо
 * 14 групп «5-А … 11-Б» у школы ровно одна группа, и ученик при регистрации
 * не выбирает класс — он попадает в неё автоматически.
 */
export const SINGLE_CLASS_NAME = "Общий";

/**
 * Коды школ, у которых ровно один общий класс.
 *
 * Перепривязку данных выполняет `ensureSchoolClasses` в `@/lib/schools`:
 * старые классы удаляются, а пользователи (ученики), уроки и ДЗ школы
 * переводятся на `SINGLE_CLASS_NAME`. Список хранится отдельно от
 * `CONFIGURED_SCHOOLS`, чтобы не менять контракт конфига школ
 * (`scripts/rules.test.ts` сверяет его дословно).
 */
export const SINGLE_CLASS_SCHOOL_CODES = ["Anna.Terentieva77"] as const;

/** Настроена ли школа на единственный общий класс (по коду, без учёта регистра). */
export function isSingleClassSchool(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  // Псевдонимы (`DUSHA`, `SOUL`) раскрываются в код школы из базы.
  const needle = (canonicalSchoolCode(code) ?? code.trim().toUpperCase()).toLowerCase();
  return SINGLE_CLASS_SCHOOL_CODES.some((schoolCode) => schoolCode.toLowerCase() === needle);
}

/**
 * Названия классов, которые обязаны существовать у школы.
 *
 * Обычная школа — стандартный набор «5-А … 11-Б»; школа из
 * `SINGLE_CLASS_SCHOOL_CODES` — единственный класс `SINGLE_CLASS_NAME`.
 */
export function defaultClassNamesForSchool(code: string | null | undefined): readonly string[] {
  return isSingleClassSchool(code) ? [SINGLE_CLASS_NAME] : DEFAULT_CLASS_NAMES;
}
