/** Schools provisioned by the application/Prisma seed. Codes are stored exactly as written. */
export const CONFIGURED_SCHOOLS = [
  { name: "Лицей Сингулярити", code: "Sinlycem26" },
  { name: "Fullhouse Teem  ", code: "Fulhouseteem26" },
  { name: "Школа Душа", code: "Anna.Terentieva77" },
] as const;

export const DEFAULT_SCHOOL = CONFIGURED_SCHOOLS[0];

/** The old single-tenant demo code is migrated into the primary school. */
export const LEGACY_DEFAULT_SCHOOL_CODE = "SCHOOL1";

const DEFAULT_CLASS_LETTERS = ["А", "Б"] as const;

/** The default groups created for every provisioned school (5-А … 11-Б). */
export const DEFAULT_CLASS_NAMES = [5, 6, 7, 8, 9, 10, 11].flatMap((grade) =>
  DEFAULT_CLASS_LETTERS.map((letter) => `${grade}-${letter}`),
);
