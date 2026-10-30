/**
 * Иллюстрации ИИ: браузер никогда не обращается к внешнему генератору картинок.
 *
 * Зачем нужен прокси `/api/ai/image`:
 *  — CSP сайта разрешает изображения только со своего origin (`img-src 'self'
 *    data: blob:`). Прямая ссылка на `image.pollinations.ai` молча блокировалась
 *    браузером, поэтому иллюстрации ИИ не появлялись вообще — ни с VPN, ни без;
 *  — у части сетей внешний домен недоступен, а сервер (Render) достаёт его
 *    всегда: картинка приходит с нашего же origin;
 *  — адрес генератора собирается на сервере из `prompt` + `seed`, поэтому
 *    произвольный URL из запроса не может стать SSRF-вектором.
 *
 * Раньше сохранённые ответы моделей содержат прямые ссылки на генератор —
 * `toSameOriginImageUrl` переписывает их на прокси при отрисовке, так что старые
 * уроки тоже начинают показывать картинки.
 */

/** Маршрут прокси, с которого браузер забирает изображение. */
export const AI_IMAGE_ROUTE = "/api/ai/image";
/** Ограничение длины запроса: длиннее генератор всё равно не примет. */
export const AI_IMAGE_MAX_PROMPT = 400;
/** Потолок отдаваемой картинки — защита памяти процесса. */
export const AI_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
/** Генератор иллюстраций (единственный разрешённый внешний адрес). */
const POLLINATIONS_ORIGIN = "https://image.pollinations.ai";
const POLLINATIONS_HOSTS = new Set(["image.pollinations.ai", "pollinations.ai"]);
const MAX_SEED = 999_999;

export interface AiImageRequest {
  prompt: string;
  seed: number;
}

function normalizeSeed(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= MAX_SEED ? value : 0;
}

/** Разбирает параметры запроса к прокси. `null` — запрос некорректный. */
export function parseAiImageRequest(params: URLSearchParams): AiImageRequest | null {
  const prompt = (params.get("prompt") ?? "").trim();
  if (!prompt || prompt.length > AI_IMAGE_MAX_PROMPT) return null;
  const rawSeed = params.get("seed");
  const seed = rawSeed === null || rawSeed === "" ? 0 : Number(rawSeed);
  if (!Number.isFinite(seed) || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) return null;
  return { prompt, seed };
}

/** Ссылка на наш прокси — её и получает браузер. */
export function buildAiImageUrl(request: AiImageRequest): string {
  return `${AI_IMAGE_ROUTE}?prompt=${encodeURIComponent(request.prompt)}&seed=${normalizeSeed(request.seed)}`;
}

/** Адрес генератора: собирается только на сервере. */
export function buildUpstreamImageUrl(request: AiImageRequest): string {
  const prompt = encodeURIComponent(request.prompt);
  return `${POLLINATIONS_ORIGIN}/prompt/${prompt}?width=512&height=512&nologo=true&seed=${normalizeSeed(request.seed)}`;
}

/**
 * Переписывает внешнюю ссылку генератора на наш прокси.
 *
 * Всё остальное (data:, blob:, свои пути и чужие домены) возвращается без
 * изменений: чужие адреса не должны незаметно превращаться в запросы к прокси.
 */
export function toSameOriginImageUrl(rawUrl: string): string {
  const value = rawUrl.trim();
  if (!value) return rawUrl;

  let parsed: URL;
  try {
    parsed = new URL(value, "https://eduflow.local");
  } catch {
    return rawUrl;
  }
  if (!POLLINATIONS_HOSTS.has(parsed.hostname.toLowerCase())) return rawUrl;

  let prompt: string;
  try {
    prompt = decodeURIComponent(parsed.pathname.replace(/^\/prompt\/?/, "")).trim();
  } catch {
    return rawUrl;
  }
  if (!prompt || prompt.length > AI_IMAGE_MAX_PROMPT) return rawUrl;

  const seed = Number(parsed.searchParams.get("seed") ?? "0");
  return buildAiImageUrl({ prompt, seed: Number.isFinite(seed) ? seed : 0 });
}
