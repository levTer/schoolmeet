/** Демо-аккаунты, которые создаёт `prisma/seed.mjs` (только для локальной разработки). */
export interface DemoAccount {
  role: "ADMIN" | "TEACHER" | "STUDENT";
  email: string;
  label: string;
}

const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "schoolmeet";

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { role: "ADMIN", email: "admin@schoolmeet.dev", label: "Администратор" },
  { role: "TEACHER", email: "teacher@schoolmeet.dev", label: "Учитель" },
  { role: "STUDENT", email: "student@schoolmeet.dev", label: "Ученик" },
];

/**
 * Показывать ли блок с демо-доступами на странице входа.
 * По умолчанию выключено — включается флагом NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS=1
 * в локальном `.env`, чтобы подсказки не попали в продакшен.
 */
export const SHOW_DEMO_CREDENTIALS = process.env.NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS === "1";

export const DEMO_PASSWORD_HINT = DEMO_PASSWORD;
