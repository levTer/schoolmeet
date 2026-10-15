/**
 * Сетевая инфраструктура WebRTC Лицея Сингулярити (этап 8): STUN/TURN-серверы.
 *
 * БАЗОВЫЙ УРОВЕНЬ — проверенные публичные STUN-серверы Google (бесплатны,
 * работают из большинства домашних сетей и помогают пирам узнать свои
 * внешние адреса):
 *   stun:stun.l.google.com:19302  и зеркала stun1…stun4.
 *
 * ШКОЛЬНЫЕ СЕТИ — за симметричным NAT и строгими файрволами одного STUN
 * мало: медиа-трафик должен идти через TURN-релей. Задайте свои TURN-серверы
 * переменной `NEXT_PUBLIC_TURN_SERVERS` (JSON-массив), например:
 *   NEXT_PUBLIC_TURN_SERVERS='[
 *     {"urls":"turn:turn.school.ru:3478","username":"schoolmeet","credential":"secret"},
 *     {"urls":"turns:turn.school.ru:5349","username":"schoolmeet","credential":"secret"}
 *   ]'
 * Поддерживаются и сокращения: строка "turn:host:3478" или объект с "url".
 * Бесплатные TURN-варианты для тестов: openrelay.metered.ca (80/443),
 * собственный coturn на дешёвом VPS — см. DEPLOYMENT.md, раздел WebRTC.
 *
 * ПОЛНЫЙ OVERRIDE (legacy) — `NEXT_PUBLIC_ICE_SERVERS` задаёт весь список
 * RTCIceServer JSON-массивом и имеет наивысший приоритет.
 *
 * Модуль работает и в браузере, и в Node: `IceServerEntry` структурно
 * совместим с `RTCIceServer` из DOM-типов и не требует их импорта.
 */

export interface IceServerEntry {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Проверенные публичные STUN-серверы Google (бесплатно, без регистрации). */
export const GOOGLE_STUN_URLS: readonly string[] = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun2.l.google.com:19302",
  "stun:stun3.l.google.com:19302",
  "stun:stun4.l.google.com:19302",
];

/** ICE-конфигурация по умолчанию: пул STUN Google. */
export const DEFAULT_ICE_SERVERS: IceServerEntry[] = [{ urls: [...GOOGLE_STUN_URLS] }];

/**
 * Нормализует произвольную запись из env в RTCIceServer:
 * строку `"turn:host:3478"`, объект `{url, username, credential}` или
 * готовый `{urls: [...]}`. Некорректные записи отбрасываются.
 */
function normalizeIceEntry(raw: unknown): IceServerEntry | null {
  if (typeof raw === "string") {
    const url = raw.trim();
    if (!/^(stun|turn|turns):/.test(url)) return null;
    return { urls: url };
  }
  if (typeof raw !== "object" || raw === null) return null;

  const record = raw as Record<string, unknown>;
  const rawUrls = record.urls ?? record.url;
  const candidates = Array.isArray(rawUrls)
    ? rawUrls.filter((u): u is string => typeof u === "string")
    : typeof rawUrls === "string"
      ? [rawUrls]
      : [];
  // Только валидные схемы ICE — http(s) и прочий мусор отбрасываются.
  const urls = candidates.map((u) => u.trim()).filter((u) => /^(stun|turn|turns):/.test(u));
  if (urls.length === 0) return null;

  const entry: IceServerEntry = { urls: urls.length === 1 ? urls[0] : urls };
  if (typeof record.username === "string" && record.username) entry.username = record.username;
  if (typeof record.credential === "string" && record.credential) entry.credential = record.credential;
  return entry;
}

function parseEnvList(raw: string | undefined, label: string): IceServerEntry[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn(`[webrtc] ${label}: ожидается JSON-массив — значение проигнорировано`);
      return [];
    }
    const entries = parsed.map(normalizeIceEntry).filter((e): e is IceServerEntry => e !== null);
    if (entries.length < parsed.length) {
      console.warn(`[webrtc] ${label}: часть записей некорректна и отброшена`);
    }
    return entries;
  } catch {
    console.warn(`[webrtc] ${label}: не является корректным JSON — значение проигнорировано`);
    return [];
  }
}

/**
 * Собирает итоговый список ICE-серверов:
 *  1. `NEXT_PUBLIC_ICE_SERVERS` задан и валиден → используется КАК ЕСТЬ (legacy override);
 *  2. иначе → STUN Google + TURN-серверы из `NEXT_PUBLIC_TURN_SERVERS` (если заданы).
 */
export function getIceServers(env: NodeJS.ProcessEnv = process.env): IceServerEntry[] {
  const legacy = parseEnvList(env.NEXT_PUBLIC_ICE_SERVERS, "NEXT_PUBLIC_ICE_SERVERS");
  if (legacy.length > 0) return legacy;

  const turn = parseEnvList(env.NEXT_PUBLIC_TURN_SERVERS, "NEXT_PUBLIC_TURN_SERVERS");
  return [...DEFAULT_ICE_SERVERS, ...turn];
}

/** Человекочитаемая сводка конфигурации (для логов и отладки). */
export function describeIceServers(env: NodeJS.ProcessEnv = process.env): string {
  const servers = getIceServers(env);
  const turnCount = servers
    .flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]))
    .filter((url) => url.startsWith("turn")).length;
  return `${servers.length} записей ICE (${turnCount} TURN)`;
}
