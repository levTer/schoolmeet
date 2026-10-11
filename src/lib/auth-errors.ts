/**
 * Коды ошибок входа.
 *
 * `CredentialsProvider.authorize()` бросает ошибку с коротким кодом — NextAuth
 * кладёт его в редирект (`?error=<код>`), откуда клиент (`signIn` с
 * `redirect: false`) читает его как `res.error`. Модуль не тянет ни Prisma,
 * ни next-auth, поэтому его безопасно импортировать и на сервере, и в UI.
 */
export const LOGIN_ERROR = {
  missingCredentials: "MISSING_CREDENTIALS",
  userNotFound: "USER_NOT_FOUND",
  invalidPassword: "INVALID_PASSWORD",
} as const;

export type LoginErrorCode = (typeof LOGIN_ERROR)[keyof typeof LOGIN_ERROR];

/** Коды, которые NextAuth возвращает сам (без нашего `authorize`). */
const NEXTAUTH_ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Неверный email или пароль",
  SessionRequired: "Войдите, чтобы продолжить",
  AccessDenied: "Доступ запрещён",
  Configuration: "Ошибка конфигурации авторизации на сервере",
  OAuthAccountNotLinked: "Этот email уже привязан к другому способу входа",
};

/** Человекочитаемые сообщения для всех кодов ошибок входа. */
export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  [LOGIN_ERROR.missingCredentials]: "Введите email и пароль",
  [LOGIN_ERROR.userNotFound]: "Пользователь с таким email не найден",
  [LOGIN_ERROR.invalidPassword]: "Неверный пароль",
  ...NEXTAUTH_ERROR_MESSAGES,
};

const DEFAULT_LOGIN_ERROR = "Не удалось войти. Проверьте данные и попробуйте ещё раз.";

/** Превращает код ошибки NextAuth в текст для пользователя. */
export function resolveLoginErrorMessage(code?: string | null): string {
  if (!code) return DEFAULT_LOGIN_ERROR;
  return LOGIN_ERROR_MESSAGES[code] ?? DEFAULT_LOGIN_ERROR;
}
