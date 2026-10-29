/**
 * WebRTC transport policy.
 *
 * GLOBAL_RTC_CONFIG is the compatibility/diagnostic baseline requested by the
 * product. Calls do NOT use `iceTransportPolicy: "all"`: that permits a direct
 * UDP path even when a TURN server is present. The call engine instead uses
 * getRelayRtcConfiguration(), which contains only authenticated TCP TURN URLs.
 *
 * Configure production TURN with NEXT_PUBLIC_TURN_SERVERS. These values are
 * public browser configuration, not server secrets. Prefer short-lived TURN
 * credentials issued by your TURN provider over a permanent shared password.
 * The legacy OpenRelay endpoints are best-effort examples, not an availability
 * guarantee. NEXT_PUBLIC_ICE_SERVERS remains a legacy diagnostic override.
 */
export interface IceServerEntry {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const GLOBAL_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:openrelay.metered.ca:80" },
    { urls: "stun:openrelay.metered.ca:443" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turns:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
  iceTransportPolicy: "all",
};

export const VPN_FRIENDLY_MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: { width: { ideal: 640, max: 1280 }, height: { ideal: 360, max: 720 }, frameRate: { ideal: 20, max: 30 } },
};

export const GOOGLE_STUN_URLS: readonly string[] = [
  "stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302",
  "stun:stun2.l.google.com:19302", "stun:stun3.l.google.com:19302",
  "stun:stun4.l.google.com:19302",
];
export const DEFAULT_ICE_SERVERS: IceServerEntry[] = [{ urls: [...GOOGLE_STUN_URLS] }];

function normalizeIceEntry(raw: unknown): IceServerEntry | null {
  if (typeof raw === "string") return /^(stun|turn|turns):/.test(raw.trim()) ? { urls: raw.trim() } : null;
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const rawUrls = record.urls ?? record.url;
  const candidates = Array.isArray(rawUrls) ? rawUrls : [rawUrls];
  const urls = candidates.filter((u): u is string => typeof u === "string")
    .map((u) => u.trim()).filter((u) => /^(stun|turn|turns):/.test(u));
  if (!urls.length) return null;
  const entry: IceServerEntry = { urls: urls.length === 1 ? urls[0] : urls };
  if (typeof record.username === "string" && record.username) entry.username = record.username;
  if (typeof record.credential === "string" && record.credential) entry.credential = record.credential;
  return entry;
}

function parseEnvList(raw: string | undefined, label: string): IceServerEntry[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    const entries = parsed.map(normalizeIceEntry).filter((e): e is IceServerEntry => e !== null);
    if (entries.length !== parsed.length) console.warn(`[webrtc] ${label}: некорректные записи отброшены`);
    return entries;
  } catch {
    console.warn(`[webrtc] ${label}: ожидается JSON-массив, значение проигнорировано`);
    return [];
  }
}

/** Legacy full ICE list, retained for diagnostics and existing deployments. */
export function getIceServers(env: NodeJS.ProcessEnv = process.env): IceServerEntry[] {
  const legacy = parseEnvList(env.NEXT_PUBLIC_ICE_SERVERS, "NEXT_PUBLIC_ICE_SERVERS");
  if (legacy.length) return legacy;
  const turn = parseEnvList(env.NEXT_PUBLIC_TURN_SERVERS, "NEXT_PUBLIC_TURN_SERVERS");
  return turn.length ? [...DEFAULT_ICE_SERVERS, ...turn] : [...GLOBAL_RTC_CONFIG.iceServers!];
}

/** Ordered transport attempts. URL order inside a browser is not a failover. */
export const RELAY_STAGES = ["turns-tcp-443", "turn-tcp-443", "turn-tcp-80", "custom-tcp"] as const;
export type RelayStage = 0 | 1 | 2 | 3;
export const RELAY_CONNECT_TIMEOUT_MS = [8_000, 8_000, 10_000, 10_000] as const;

function tcpTurnUrl(raw: string): string | null {
  if (!/^turns?:/i.test(raw)) return null;
  // A TURN URL is not an HTTP URL. Parse its authority without importing one.
  const match = /^(turns?):([^?#]+)(\?[^#]*)?$/i.exec(raw);
  if (!match) return null;
  const params = new URLSearchParams(match[3]?.slice(1) ?? "");
  const transport = params.get("transport")?.toLowerCase();
  if (transport && transport !== "tcp") return null;
  params.set("transport", "tcp");
  return `${match[1].toLowerCase()}:${match[2]}?${params.toString()}`;
}

function stageForUrl(url: string): RelayStage | null {
  const lower = url.toLowerCase();
  if (lower.startsWith("turns:") && /:443(?:\?|$)/.test(lower)) return 0;
  if (lower.startsWith("turn:") && /:443(?:\?|$)/.test(lower)) return 1;
  if (lower.startsWith("turn:") && /:80(?:\?|$)/.test(lower)) return 2;
  return 3;
}

/** Custom servers precede public examples at every stage; UDP/STUN never leak in. */
export function getRelayIceServers(stage: RelayStage, env: NodeJS.ProcessEnv = process.env): IceServerEntry[] {
  const legacy = parseEnvList(env.NEXT_PUBLIC_ICE_SERVERS, "NEXT_PUBLIC_ICE_SERVERS");
  const custom = parseEnvList(env.NEXT_PUBLIC_TURN_SERVERS, "NEXT_PUBLIC_TURN_SERVERS");
  const sources = legacy.length ? legacy : [...custom, ...GLOBAL_RTC_CONFIG.iceServers!];
  const result: IceServerEntry[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source.username || !source.credential) continue;
    for (const raw of Array.isArray(source.urls) ? source.urls : [source.urls]) {
      const url = tcpTurnUrl(raw);
      if (!url || stageForUrl(url) !== stage) continue;
      const key = `${url}\n${source.username}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ urls: url, username: source.username, credential: source.credential });
    }
  }
  return result;
}

export function getRelayRtcConfiguration(stage: RelayStage, env: NodeJS.ProcessEnv = process.env): RTCConfiguration {
  return {
    iceServers: getRelayIceServers(stage, env),
    iceTransportPolicy: "relay",
    iceCandidatePoolSize: 0, // do not keep stale pooled allocations across a network change
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
}

export function describeIceServers(env: NodeJS.ProcessEnv = process.env): string {
  const servers = getIceServers(env);
  const turnCount = servers.flatMap((s) => Array.isArray(s.urls) ? s.urls : [s.urls])
    .filter((url) => url.startsWith("turn")).length;
  return `${servers.length} записей ICE (${turnCount} TURN); звонки: relay-only TCP`;
}
