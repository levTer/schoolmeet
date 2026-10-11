import bcrypt from "bcryptjs";

/**
 * Стоимость bcrypt-хеширования.
 *
 * 10 раундов — баланс между стойкостью к перебору (~100 мс на проверку)
 * и отзывчивостью формы входа. Одно значение на весь проект: и регистрация,
 * и проверка пароля должны использовать одинаковую стоимость.
 */
export const BCRYPT_SALT_ROUNDS = 10;

/** Хэширует пароль (bcrypt, соль генерируется автоматически). */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_SALT_ROUNDS);
}

/**
 * Сравнивает открытый пароль с хешем из БД.
 * Всегда возвращает boolean — наружу не утекает, какая часть не совпала.
 */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
