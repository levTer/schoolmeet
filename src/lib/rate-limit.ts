/**
 * Rate-limit SchoolMeet: защита от флуда, DDoS и брутфорса пароля.
 *
 * Алгоритм — «скользящее окно с фиксированными интервалами» (fixed window):
 * на каждый ключ (IP + область) ведём счётчик и время сброса. Это простой,
 * предсказуемый и дешёвый способ ограничить частоту: одна проверка — одна
 * операция с `Map`, без таймеров и сетевых запросов.
 *
 * Модуль не зависит ни от Node, ни от DOM — его импортируют middleware
 * (edge-рантайм), API-роуты и Socket.IO-сервер. Хранилище в памяти процесса:
 * для одного инстанса приложения этого достаточно, при горизонтальном
 * масштабировании счётчики нужно перенести в Redis (см. README, «Безопасность»).
 */

/* -------------------------------------------------------------------------- */
/* Правила                                                                     */
/* -------------------------------------------------------------------------- */

export interface RateLimitRule {
  /** Сколько запросов разрешено в окне. */
  limit: number;
  /** Длина окна в миллисекундах. */
  windowMs: number;
}

/** Область лимита: своя «корзина» на каждый ключ. */
export type RateLimitScope = "global" | "auth" | "socket" | "admin";

/**
 * Правила по умолчанию.
 *
 * - `global` — 100 запросов в минуту на IP (требование этапа 6);
 * - `auth`   — вход/регистрация: жёстче, защита от брутфорса пароля;
 * - `socket` — попытки установить Socket.IO-соединение;
 * - `admin`  — админские выборки, которые бьют по БД.
 */
export const DEFAULT_RATE_LIMITS: Record<RateLimitScope, RateLimitRule> = {
  global: { limit: 100, windowMs: 60_000 },
  auth: { limit: 20, windowMs: 60_000 },
  socket: { limit: 40, windowMs: 60_000 },
  admin: { limit: 60, windowMs: 60_000 },
};

/** Переменные окружения позволяют поднять/опустить общий лимит без правки кода. */
export const RATE_LIMIT_ENV = {
  max: "RATE_LIMIT_MAX_REQUESTS",
  window: "RATE_LIMIT_WINDOW_MS",
} as const;

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Правило области с учётом переменных окружения (общий лимит можно изменить). */
export function getRateLimitRule(scope: RateLimitScope): RateLimitRule {
  const rule = DEFAULT_RATE_LIMITS[scope];
  if (scope !== "global") return rule;

  return {
    limit: readPositiveInt(process.env[RATE_LIMIT_ENV.max], rule.limit),
    windowMs: readPositiveInt(process.env[RATE_LIMIT_ENV.window], rule.windowMs),
  };
}

/* -------------------------------------------------------------------------- */
/* Хранилище счётчиков                                                         */
/* -------------------------------------------------------------------------- */

interface Bucket {
  count: number;
  /** Момент (ms), когда счётчик обнулится. */
  resetAt: number;
}

/**
 * Потолок числа корзин. При переполнении выбрасываем самые «старые» окна —
 * так память процесса не растёт бесконечно при сканировании IP-адресов.
 */
const MAX_BUCKETS = 20_000;

const buckets = new Map<string, Bucket>();

function sweep(now: number): void {
  // Удаление записи во время forEach по Map безопасно: уже пройденные не трогаем.
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) buckets.delete(key);
  });
}

export interface RateLimitResult {
  /** `true` — запрос можно выполнить. */
  ok: boolean;
  /** Сколько запросов разрешено в окне. */
  limit: number;
  /** Сколько запросов осталось в текущем окне. */
  remaining: number;
  /** Момент сброса окна (ms). */
  resetAt: number;
  /** Через сколько секунд повторять (для заголовка `Retry-After`). */
  retryAfterSeconds: number;
  /** Сколько миллисекунд осталось до сброса окна. */
  retryAfterMs: number;
}

/**
 * Списывает одну единицу квоты у ключа.
 *
 * Возвращает результат проверки: `ok: false` означает, что лимит исчерпан и
 * вызывающий код должен ответить 429 (HTTP) или отказать в соединении (Socket.IO).
 */
export function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): RateLimitResult {
  const windowMs = Math.max(1, rule.windowMs);
  const limit = Math.max(1, rule.limit);

  if (buckets.size > MAX_BUCKETS) sweep(now);

  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  const remaining = Math.max(0, limit - bucket.count);
  const retryAfterMs = Math.max(0, bucket.resetAt - now);

  return {
    ok: bucket.count <= limit,
    limit,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    retryAfterMs,
  };
}

/** Проверка без списания квоты (например, чтобы показать остаток в UI). */
export function peekRateLimit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key);
  const limit = Math.max(1, rule.limit);
  const resetAt = bucket && bucket.resetAt > now ? bucket.resetAt : now + rule.windowMs;
  const count = bucket && bucket.resetAt > now ? bucket.count : 0;

  return {
    ok: count < limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil(Math.max(0, resetAt - now) / 1000)),
    retryAfterMs: Math.max(0, resetAt - now),
  };
}

/**
 * Собирает ключ корзины: область + IP (+ уточнение).
 *
 * Ключ держим коротким и без пользовательских данных, чтобы по памяти нельзя
 * было восстановить содержимое запросов.
 */
export function rateLimitKey(scope: RateLimitScope, ip: string, suffix?: string): string {
  return suffix ? `${scope}:${ip}:${suffix}` : `${scope}:${ip}`;
}

/** Сбрасывает все счётчики — используется в тестах. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Текущее число активных корзин (диагностика/тесты). */
export function rateLimitBucketCount(): number {
  return buckets.size;
}

/* -------------------------------------------------------------------------- */
/* Определение IP клиента                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Достаёт IP клиента из заголовков прокси.
 *
 * Приложение рассчитано на работу за обратным прокси (nginx, платформа
 * хостинга), поэтому доверяем `x-forwarded-for` (первый адрес в цепочке),
 * `x-real-ip` и `cf-connecting-ip`. Без прокси заголовков нет — тогда
 * возвращаем "unknown", и все локальные запросы делят одну корзину.
 */
export function getClientIp(headers: Headers | { get(name: string): string | null }): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }

  const realIp = headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim().slice(0, 64);

  const cloudflareIp = headers.get("cf-connecting-ip");
  if (cloudflareIp?.trim()) return cloudflareIp.trim().slice(0, 64);

  return "unknown";
}

/** Заголовки ответа с состоянием лимита (стандарт X-RateLimit-*). */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    ...(result.ok ? {} : { "Retry-After": String(result.retryAfterSeconds) }),
  };
}

/**
 * IP из заголовков Node.js (`req.headers`) — нужен Socket.IO-рукопожатию, где
 * заголовки приходят объектом, а не `Headers`.
 */
export function getClientIpFromNodeHeaders(
  headers: Record<string, string | string[] | undefined>,
): string {
  const pick = (name: string): string => {
    const value = headers[name];
    if (Array.isArray(value)) return value[0] ?? "";
    return typeof value === "string" ? value : "";
  };

  const forwarded = pick("x-forwarded-for").split(",")[0]?.trim();
  if (forwarded) return forwarded.slice(0, 64);

  const direct = pick("x-real-ip") || pick("cf-connecting-ip");
  return direct.trim().slice(0, 64) || "unknown";
}

/** Списывает квоту области для известного IP (Socket.IO, фоновые задачи). */
export function consumeRateLimitForIp(
  scope: RateLimitScope,
  ip: string,
  suffix?: string,
): RateLimitResult {
  return consumeRateLimit(rateLimitKey(scope, ip, suffix), getRateLimitRule(scope));
}

/* -------------------------------------------------------------------------- */
/* Готовые проверки для middleware и серверного кода                           */
/* -------------------------------------------------------------------------- */

export interface RateLimitCheck {
  result: RateLimitResult;
  rule: RateLimitRule;
  scope: RateLimitScope;
  key: string;
}

/** Проверяет лимит области для запроса (списывает квоту). */
export function checkRequestRateLimit(
  scope: RateLimitScope,
  headers: Headers | { get(name: string): string | null },
  suffix?: string,
): RateLimitCheck {
  const ip = getClientIp(headers);
  const rule = getRateLimitRule(scope);
  const key = rateLimitKey(scope, ip, suffix);
  return { result: consumeRateLimit(key, rule), rule, scope, key };
}

/**
 * Какую область применять к пути: вход/регистрация — `auth`, админские
 * API — `admin`, всё остальное — `global`.
 */
export function scopeForPath(pathname: string): RateLimitScope {
  if (pathname.startsWith("/api/auth")) return "auth";
  if (pathname.startsWith("/api/admin")) return "admin";
  return "global";
}

export interface PathRateLimit {
  /** Все проверенные корзины (для заголовков ответа). */
  checks: RateLimitCheck[];
  /** Первая исчерпанная корзина — запрос надо отклонить (429). */
  blocked: RateLimitCheck | null;
}

/**
 * Проверяет запрос по всем применимым правилам.
 *
 * Общий лимит действует всегда, поэтому его нельзя обойти, выбрав «мягкий»
 * раздел; для `/api/auth` и `/api/admin` дополнительно применяется строгое
 * правило области.
 */
export function checkPathRateLimit(
  pathname: string,
  headers: Headers | { get(name: string): string | null },
): PathRateLimit {
  const ip = getClientIp(headers);
  const scope = scopeForPath(pathname);

  const rules: { scope: RateLimitScope; rule: RateLimitRule }[] = [
    { scope: "global", rule: getRateLimitRule("global") },
  ];
  if (scope !== "global") rules.push({ scope, rule: getRateLimitRule(scope) });

  const checks = rules.map(({ scope: current, rule }) => {
    const key = rateLimitKey(current, ip);
    return { result: consumeRateLimit(key, rule), rule, scope: current, key };
  });

  return { checks, blocked: checks.find((check) => !check.result.ok) ?? null };
}
