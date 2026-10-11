/**
 * Контракт реального времени SchoolMeet: события Socket.IO между браузером и
 * `server.ts`. Файл не зависит ни от сервера, ни от DOM — его импортируют и
 * клиентские хуки, и серверный модуль realtime.
 */

import type { Role } from "@/types";

/* -------------------------------------------------------------------------- */
/* Константы                                                                   */
/* -------------------------------------------------------------------------- */

/** Путь Socket.IO на том же HTTP-порту, что и Next.js. */
export const SOCKET_PATH = "/socket.io";

/** Лимиты, чтобы один клиент не мог залить комнату. */
export const CHAT_MAX_CIPHERTEXT_LENGTH = 8000;
export const CHAT_HISTORY_LIMIT = 50;
export const CHAT_RATE_LIMIT_PER_SECOND = 5;
export const SDP_MAX_LENGTH = 64_000;

/** Код урока: slug вида `math-101-class` (латиница, цифры, дефисы). */
const ROOM_CODE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidRoomCode(value: unknown): value is string {
  return typeof value === "string" && value.length >= 3 && value.length <= 48 && ROOM_CODE_REGEX.test(value);
}

/* -------------------------------------------------------------------------- */
/* Общие типы                                                                  */
/* -------------------------------------------------------------------------- */

/** Состояние медиа участника: микрофон, камера, демонстрация экрана. */
export interface MediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
}

export const DEFAULT_MEDIA_STATE: MediaState = { audio: false, video: false, screen: false };

/** Участник комнаты. `socketId` — идентификатор WebRTC-пира внутри комнаты. */
export interface RoomParticipant {
  socketId: string;
  userId: string;
  name: string;
  role: Role;
  media: MediaState;
  handRaised: boolean;
}

/** Автор сообщения чата (без чувствительных полей). */
export interface ChatAuthor {
  userId: string;
  name: string;
  role: Role;
}

/**
 * Зашифрованное сообщение чата. Сервер видит только `ciphertext` (формат см.
 * в `src/lib/crypto.ts`), текст сообщения он не знает.
 */
export interface ChatEnvelope {
  id: string;
  ciphertext: string;
  createdAt: string;
  author: ChatAuthor;
}

/** SDP-описание и ICE-кандидаты, которыми обмениваются пиры через сервер. */
export type SignalData =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | {
      type: "candidate";
      candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null;
    };

export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; code: string; error: string };

export interface JoinRoomResult {
  self: RoomParticipant;
  participants: RoomParticipant[];
  history: ChatEnvelope[];
}

/* -------------------------------------------------------------------------- */
/* События Socket.IO                                                           */
/* -------------------------------------------------------------------------- */

export interface ClientToServerEvents {
  /** Войти в комнату урока. Доступ — только с действующей JWT-сессией. */
  "join-room": (payload: { roomId: string }, ack: (result: Ack<JoinRoomResult>) => void) => void;
  /** Покинуть комнату (сокет остаётся подключённым). */
  "leave-room": () => void;
  /** Передача SDP offer/answer и ICE-кандидатов конкретному пиру. */
  signal: (payload: { to: string; data: SignalData }) => void;
  /** Поднять / опустить руку. */
  "raise-hand": (payload: { raised: boolean }) => void;
  /** Сообщение чата — уже зашифровано на клиенте (AES-256). */
  "chat-message": (payload: { ciphertext: string }, ack?: (result: Ack<{ id: string }>) => void) => void;
  /** Изменение состояния микрофона / камеры / экрана. */
  "media-state": (payload: MediaState) => void;
}

export interface ServerToClientEvents {
  /** Другой участник вошёл в комнату. */
  "user-joined": (participant: RoomParticipant) => void;
  /** Участник вышел или отключился. */
  "user-left": (payload: { socketId: string }) => void;
  /** Входящий сигнал от пира `from`. */
  signal: (payload: { from: string; data: SignalData }) => void;
  "raise-hand": (payload: { socketId: string; raised: boolean }) => void;
  "chat-message": (message: ChatEnvelope) => void;
  "media-state": (payload: { socketId: string; media: MediaState }) => void;
}

/** Данные, которые сервер хранит в сокете после аутентификации. */
export interface SocketUser {
  id: string;
  name: string;
  role: Role;
}
