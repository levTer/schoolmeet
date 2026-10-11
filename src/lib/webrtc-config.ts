/**
 * Настройки ICE для WebRTC.
 *
 * По умолчанию — публичный STUN, достаточно для большинства домашних сетей.
 * В школьных сетях с симметричным NAT и строгими файрволами нужен TURN-сервер:
 * задайте NEXT_PUBLIC_ICE_SERVERS JSON-массивом RTCIceServer, например
 * [{"urls":"stun:stun.example.org:3478"},{"urls":"turn:turn.example.org:3478","username":"u","credential":"p"}]
 */

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function getIceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_ICE_SERVERS;
  if (!raw) return DEFAULT_ICE_SERVERS;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as RTCIceServer[];
  } catch {
    console.warn("[webrtc] NEXT_PUBLIC_ICE_SERVERS не является корректным JSON — используем STUN по умолчанию");
  }
  return DEFAULT_ICE_SERVERS;
}
