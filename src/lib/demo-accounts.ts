/**
 * Аккаунты быстрого входа, которые показываются на странице логина.
 *
 * Эти реквизиты намеренно доступны клиенту: кнопка заполняет оба поля формы,
 * после чего пользователь сам подтверждает вход кнопкой «Войти».
 */
export interface QuickLoginAccount {
  email: string;
  password: string;
  label: string;
}

export const QUICK_LOGIN_ACCOUNTS: readonly QuickLoginAccount[] = [
  {
    email: "admin@schoolmeet.ru",
    password: "Admin123!",
    label: "🏫 Синлицей (Админ)",
  },
  {
    email: "fullhouse@schoolmeet.ru",
    password: "Fullhouse123!",
    label: "🏰 Fullhouse (Админ)",
  },
  {
    email: "anna@schoolmeet.ru",
    password: "Anna123!",
    label: "🌸 Anna T (Админ)",
  },
];
