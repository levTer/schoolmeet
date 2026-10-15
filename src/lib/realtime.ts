/**
 * Контракт реального времени Лицея Сингулярити: события Socket.IO между браузером и
 * `server.ts`. Файл не зависит ни от сервера, ни от DOM — его импортируют и
 * клиентские хуки, и серверный модуль realtime.
 */

import type { GradeCode } from "@/lib/schedule-rules";
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

/* --- Лимиты доски --------------------------------------------------------- */

/** Максимум страниц в доске одного урока. */
export const WHITEBOARD_MAX_PAGES = 20;
/** Максимум объектов на одной странице (защита памяти сервера). */
export const WHITEBOARD_MAX_OBJECTS_PER_PAGE = 2000;
/** Максимальный размер JSON одного объекта Fabric.js. */
export const WHITEBOARD_MAX_OBJECT_JSON = 64 * 1024;
/** Частота событий рисования (add/modify/delete/clear) — не больше N в секунду. */
export const WHITEBOARD_RATE_LIMIT_PER_SECOND = 30;
/** Частота событий курсора — не больше N в секунду. */
export const WHITEBOARD_CURSOR_RATE_LIMIT_PER_SECOND = 40;
/** Через сколько миллисекунд молчащий курсор участника скрывается у других. */
export const WHITEBOARD_CURSOR_TTL_MS = 5000;

/** Код урока: slug вида `math-101-class` (латиница, цифры, дефисы). */
const ROOM_CODE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidRoomCode(value: unknown): value is string {
  return typeof value === "string" && value.length >= 3 && value.length <= 48 && ROOM_CODE_REGEX.test(value);
}

/** The physical Socket.IO room is always namespaced by school and lesson ID. */
export function buildSchoolRoomId(schoolId: string, lessonId: string): string {
  return `room:${schoolId}:${lessonId}`;
}

/** Fail closed when either tenant is absent or the lesson belongs to another school. */
export function hasSchoolAccess(
  userSchoolId: string | null | undefined,
  resourceSchoolId: string | null | undefined,
): boolean {
  return Boolean(userSchoolId && resourceSchoolId && userSchoolId === resourceSchoolId);
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

  /* Доска: рисование (только с правом; сервер проверяет политику) */
  "whiteboard-add": (payload: WhiteboardObjectPayload, ack?: (result: Ack) => void) => void;
  "whiteboard-modify": (payload: WhiteboardObjectPayload, ack?: (result: Ack) => void) => void;
  "whiteboard-delete": (payload: WhiteboardDeletePayload, ack?: (result: Ack) => void) => void;
  "whiteboard-clear": (payload: WhiteboardClearPayload, ack?: (result: Ack) => void) => void;
  /** Курсор участника (доступно всем зрителям доски). */
  "whiteboard-cursor": (payload: WhiteboardCursorPayload) => void;
  /** Сменить политику рисования (только TEACHER / ADMIN). */
  "whiteboard-access": (
    payload: { drawPolicy: WhiteboardDrawPolicy },
    ack?: (result: Ack) => void,
  ) => void;
  /** Переключить общую страницу доски. */
  "whiteboard-page": (payload: { page: number }, ack?: (result: Ack) => void) => void;
  /** Запросить полное состояние доски (при открытии панели). */
  "whiteboard-sync": (payload: Record<string, never> | undefined, ack: (result: Ack<WhiteboardState>) => void) => void;
}

/**
 * Причина принудительного закрытия комнаты администратором: клиент показывает
 * экран «Урок завершён» вместо бесконечного переподключения.
 */
export interface RoomClosedPayload {
  reason: "admin_force_end" | string;
  message: string;
}

/** Причина разрыва сессии сервером (например, блокировка аккаунта). */
export interface SessionRevokedPayload {
  reason: "account_banned" | string;
  message: string;
}

export interface ServerToClientEvents {
  /** Другой участник вошёл в комнату. */
  "user-joined": (participant: RoomParticipant) => void;
  /** Участник вышел или отключился. */
  "user-left": (payload: { socketId: string }) => void;
  /** Администратор принудительно завершил урок — комната закрыта для всех. */
  "room-closed": (payload: RoomClosedPayload) => void;
  /** Доступ отозван на уровне аккаунта (блокировка) — сокет будет разорван. */
  "session-revoked": (payload: SessionRevokedPayload) => void;
  /** Входящий сигнал от пира `from`. */
  signal: (payload: { from: string; data: SignalData }) => void;
  "raise-hand": (payload: { socketId: string; raised: boolean }) => void;
  "chat-message": (message: ChatEnvelope) => void;
  "media-state": (payload: { socketId: string; media: MediaState }) => void;

  /* Доска: события приходят от других участников (автор не получает эхо) */
  "whiteboard-add": (payload: WhiteboardObjectPayload) => void;
  "whiteboard-modify": (payload: WhiteboardObjectPayload) => void;
  "whiteboard-delete": (payload: WhiteboardDeletePayload) => void;
  "whiteboard-clear": (payload: WhiteboardClearPayload) => void;
  "whiteboard-cursor": (payload: WhiteboardCursor) => void;
  /** Политика рисования изменилась (рассылается всем, включая инициатора). */
  "whiteboard-access": (payload: { drawPolicy: WhiteboardDrawPolicy }) => void;
  /** Общая страница доски сменилась (рассылается всем, включая инициатора). */
  "whiteboard-page": (payload: { page: number }) => void;
}

/**
 * Данные, которые сервер хранит в сокете после аутентификации.
 * `grade` нужен админ-панели: по классу участников она определяет, какой
 * класс учится в комнате, когда урок создан вручную (без расписания).
 */
export interface SocketUser {
  id: string;
  name: string;
  role: Role;
  schoolId: string;
  grade: GradeCode | null;
}

/* -------------------------------------------------------------------------- */
/* Доска (whiteboard)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Кто может рисовать на доске.
 *  - `moderators` — только TEACHER и ADMIN (политика по умолчанию);
 *  - `everyone`   — все участники урока.
 * Учитель переключает политику из интерфейса доски, сервер проверяет её при
 * каждом событии рисования.
 */
export type WhiteboardDrawPolicy = "moderators" | "everyone";

export const WHITEBOARD_DEFAULT_DRAW_POLICY: WhiteboardDrawPolicy = "moderators";

/** Объект доски: сериализованный объект Fabric.js + его id + номер страницы. */
export interface WhiteboardObjectPayload {
  /** Уникальный id объекта (входит в JSON как customProperty). */
  id: string;
  /** Номер страницы доски (0-based). */
  page: number;
  /** Результат `object.toObject()` Fabric.js (включает `id`, `customType`). */
  json: Record<string, unknown>;
}

export interface WhiteboardDeletePayload {
  page: number;
  objectIds: string[];
}

export interface WhiteboardClearPayload {
  /** Номер страницы либо `"all"` — очистить всю доску. */
  page: number | "all";
}

export interface WhiteboardCursorPayload {
  page: number;
  /** Координаты курсора в нормализованных 0..1 (не зависят от размера экрана). */
  x: number;
  y: number;
}

/** Курсор участника, как его видят другие клиенты. */
export interface WhiteboardCursor extends WhiteboardCursorPayload {
  socketId: string;
  name: string;
}

/** Страница доски: объекты Fabric.js по id. */
export interface WhiteboardPageSnapshot {
  objects: Record<string, Record<string, unknown>>;
}

/** Полное состояние доски урока — отдаётся запоздавшим участникам. */
export interface WhiteboardState {
  drawPolicy: WhiteboardDrawPolicy;
  /** Текущая общая страница (0-based). */
  page: number;
  pages: WhiteboardPageSnapshot[];
}

/**
 * Все входящие события доски в одном дискриминированном объединении —
 * клиентская подписка (`onWhiteboard`) получает их одной функцией.
 */
export type WhiteboardServerEvent =
  | { type: "add"; payload: WhiteboardObjectPayload }
  | { type: "modify"; payload: WhiteboardObjectPayload }
  | { type: "delete"; payload: WhiteboardDeletePayload }
  | { type: "clear"; payload: WhiteboardClearPayload }
  | { type: "cursor"; payload: WhiteboardCursor }
  | { type: "access"; payload: { drawPolicy: WhiteboardDrawPolicy } }
  | { type: "page"; payload: { page: number } };
