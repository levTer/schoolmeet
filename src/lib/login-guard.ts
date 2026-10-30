/**
 * Защита входа от подбора пароля (brute-force / credential stuffing).
 *
 * Rate-limit в `middleware.ts` ограничивает частоту по IP, но распределённый
 * перебор с многих IP его обходит. Здесь считаем НЕУДАЧНЫЕ попытки по
 * нормализованному email и включаем прогрессивную блокировку:
 *
 *  5 провалов в окне 15 минут → блокировка на 1 минуту,
 *  каждые следующие 5 провалов   → блокировка удваивается (1 → 2 → 4 → 8 мин, максимум 15).
 *
 * Успешный вход сбрасывает счётчик. Хранилище — в памяти процесса: при
 * нескольких инстансах счётчики нужно перенести в Redis (как и rate-limit,
 * см. `src/lib/rate-limit.ts`). Модуль чистый (без Node/Prisma) — тестируется
 * без БД и сети.
 */

/** Окно, в котором считаются неудачные попытки. */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
/** Сколько провалов допускается до блокировки. */
export const LOGIN_MAX_FAILURES = 5;
/** Базовая длительность блокировки. */
const LOCK_BASE_MS = 60_000;
/** Потолок длительности блокировки. */
export const LOGIN_MAX_LOCK_MS = 15 * 60_000;
/** Потолок числа записей, чтобы память не росла при переборе адресов. */
const MAX_TRACKED_ACCOUNTS = 10_000;

interface FailureRecord {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const failures = new Map<string, FailureRecord>();

/** Ключ счётчика: нормализованный email (регистр и пробелы не важны). */
export function loginGuardKey(email: string): string {
  return email.trim().toLowerCase();
}

function sweep(now: number): void {
  failures.forEach((record, key) => {
    if (record.lockedUntil <= now && now - record.firstFailureAt > LOGIN_FAILURE_WINDOW_MS) {
      failures.delete(key);
    }
  });
}

/** Состояние блокировки аккаунта на момент `now`. */
export interface LoginLockStatus {
  locked: boolean;
  retryAfterSeconds: number;
  failures: number;
}

export function loginLockStatus(email: string, now: number = Date.now()): LoginLockStatus {
  const key = loginGuardKey(email);
  const record = failures.get(key);
  if (!record) return { locked: false, retryAfterSeconds: 0, failures: 0 };

  if (record.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000),
      failures: record.failures,
    };
  }

  return { locked: false, retryAfterSeconds: 0, failures: record.failures };
}

/**
 * Регистрирует неудачную попытку входа.
 * Возвращает состояние после регистрации (включая только что включённую блокировку).
 */
export function registerLoginFailure(email: string, now: number = Date.now()): LoginLockStatus {
  const key = loginGuardKey(email);
  if (failures.size > MAX_TRACKED_ACCOUNTS) sweep(now);

  const existing = failures.get(key);
  const withinWindow = existing && now - existing.firstFailureAt <= LOGIN_FAILURE_WINDOW_MS;

  const failuresCount = withinWindow ? existing!.failures + 1 : 1;
  const firstFailureAt = withinWindow ? existing!.firstFailureAt : now;

  let lockedUntil = existing?.lockedUntil ?? 0;
  if (failuresCount >= LOGIN_MAX_FAILURES) {
    const lockMultiplier = Math.floor(failuresCount / LOGIN_MAX_FAILURES);
    const lockMs = Math.min(LOCK_BASE_MS * 2 ** (lockMultiplier - 1), LOGIN_MAX_LOCK_MS);
    lockedUntil = now + lockMs;
  }

  failures.set(key, { failures: failuresCount, firstFailureAt, lockedUntil });
  return loginLockStatus(email, now);
}

/** Сбрасывает счётчик после успешного входа. */
export function resetLoginFailures(email: string): void {
  failures.delete(loginGuardKey(email));
}

/** Сбрасывает все счётчики — используется в тестах. */
export function resetLoginGuard(): void {
  failures.clear();
}

/** Текущее число отслеживаемых аккаунтов (диагностика/тесты). */
export function trackedLoginAccounts(): number {
  return failures.size;
}
