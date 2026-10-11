import type { IncomingHttpHeaders, Server as HttpServer } from "node:http";
import { getToken } from "next-auth/jwt";
import { Server, type Socket } from "socket.io";

import {
  CHAT_MAX_CIPHERTEXT_LENGTH,
  CHAT_RATE_LIMIT_PER_SECOND,
  DEFAULT_MEDIA_STATE,
  SDP_MAX_LENGTH,
  SOCKET_PATH,
  WHITEBOARD_CURSOR_RATE_LIMIT_PER_SECOND,
  WHITEBOARD_DEFAULT_DRAW_POLICY,
  WHITEBOARD_MAX_OBJECTS_PER_PAGE,
  WHITEBOARD_MAX_OBJECT_JSON,
  WHITEBOARD_MAX_PAGES,
  WHITEBOARD_RATE_LIMIT_PER_SECOND,
  isValidRoomCode,
  type Ack,
  type ClientToServerEvents,
  type JoinRoomResult,
  type MediaState,
  type RoomParticipant,
  type ServerToClientEvents,
  type SignalData,
  type SocketUser,
  type WhiteboardClearPayload,
  type WhiteboardCursorPayload,
  type WhiteboardDeletePayload,
  type WhiteboardDrawPolicy,
  type WhiteboardObjectPayload,
  type WhiteboardState,
} from "@/lib/realtime";
import { findMeetingByCode, loadRecentMessages, saveChatMessage } from "@/lib/meetings";
import type { Role } from "@/types";

/**
 * Socket.IO-сервер SchoolMeet. Подключается к тому же HTTP-серверу, что и Next.js
 * (см. `server.ts` в корне), поэтому realtime работает на одном порту.
 *
 * Безопасность:
 *  - рукопожатие принимается только с действующей JWT-сессией NextAuth (cookie);
 *  - Origin браузера должен совпадать с хостом приложения (защита от
 *    cross-site WebSocket hijacking — cookie уходят с любым WebSocket-запросом);
 *  - вход в комнату проверяет, что урок с таким кодом существует в БД;
 *  - сообщения чата приходят уже зашифрованными, сервер их не расшифровывает.
 */

interface SocketData {
  user: SocketUser;
  roomId?: string;
  meetingId?: string;
  media: MediaState;
  handRaised: boolean;
  chatWindowStart: number;
  chatCount: number;
  wbWindowStart: number;
  wbCount: number;
  wbCursorWindowStart: number;
  wbCursorCount: number;
}

type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type RealtimeSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const roomKey = (roomId: string) => `meeting:${roomId}`;

/* -------------------------------------------------------------------------- */
/* Аутентификация                                                              */
/* -------------------------------------------------------------------------- */

function parseCookieHeader(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

/** Достаёт пользователя из подписанного JWT-cookie NextAuth. `null` — сессии нет. */
export async function authenticateHandshake(headers: IncomingHttpHeaders): Promise<SocketUser | null> {
  const cookieHeader = typeof headers.cookie === "string" ? headers.cookie : "";
  if (!cookieHeader) return null;

  const token = await getToken({
    // getToken читает cookie из `req.cookies` или из заголовка — передаём оба.
    req: { cookies: parseCookieHeader(cookieHeader), headers: { cookie: cookieHeader } } as never,
    secret: process.env.NEXTAUTH_SECRET,
  });
  if (!token) return null;

  const id = typeof token.id === "string" ? token.id : token.sub;
  if (!id) return null;

  return {
    id,
    name: typeof token.name === "string" && token.name ? token.name : "Участник",
    role: (token.role as Role | undefined) ?? "STUDENT",
  };
}

/**
 * Разрешённые Origin: адрес приложения из NEXTAUTH_URL и текущий Host
 * (включая x-forwarded-host за прокси). Запросы без Origin — не из браузера —
 * пропускаем, их всё равно не пройдёт проверка JWT.
 */
export function isAllowedOrigin(headers: IncomingHttpHeaders): boolean {
  const origin = headers.origin;
  if (!origin) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const candidates = new Set<string>();
  const host = headers.host;
  if (host) candidates.add(host);
  const forwarded = headers["x-forwarded-host"];
  if (typeof forwarded === "string") candidates.add(forwarded.split(",")[0].trim());

  if (process.env.NEXTAUTH_URL) {
    try {
      candidates.add(new URL(process.env.NEXTAUTH_URL).host);
    } catch {
      /* некорректный NEXTAUTH_URL — полагаемся на Host заголовок */
    }
  }

  return candidates.has(originHost);
}

/* -------------------------------------------------------------------------- */
/* Комнаты и участники                                                         */
/* -------------------------------------------------------------------------- */

function toParticipant(socket: { id: string; data: SocketData }): RoomParticipant {
  return {
    socketId: socket.id,
    userId: socket.data.user.id,
    name: socket.data.user.name,
    role: socket.data.user.role,
    media: socket.data.media,
    handRaised: socket.data.handRaised,
  };
}

async function listParticipants(io: RealtimeServer, roomId: string): Promise<RoomParticipant[]> {
  const sockets = await io.in(roomKey(roomId)).fetchSockets();
  return sockets.map((socket) => toParticipant(socket));
}

/** Покидает текущую комнату сокета и сообщает остальным. */
function leaveCurrentRoom(socket: RealtimeSocket): void {
  const { roomId } = socket.data;
  if (!roomId) return;

  void socket.leave(roomKey(roomId));
  socket.to(roomKey(roomId)).emit("user-left", { socketId: socket.id });

  socket.data.roomId = undefined;
  socket.data.meetingId = undefined;
  socket.data.media = { ...DEFAULT_MEDIA_STATE };
  socket.data.handRaised = false;

  removeRoomMember(roomId);
}

function reply<T>(ack: unknown, result: Ack<T>): void {
  if (typeof ack === "function") (ack as (value: Ack<T>) => void)(result);
}

/** Простой лимит на частоту сообщений: не больше N сообщений в секунду. */
function takeChatToken(socket: RealtimeSocket): boolean {
  return takeToken(socket, "chat", CHAT_RATE_LIMIT_PER_SECOND);
}

function isSignalData(value: unknown): value is SignalData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as { type?: unknown; sdp?: unknown; candidate?: unknown };

  if (data.type === "offer" || data.type === "answer") {
    return typeof data.sdp === "string" && data.sdp.length > 0 && data.sdp.length <= SDP_MAX_LENGTH;
  }
  if (data.type === "candidate") {
    return data.candidate === null || (typeof data.candidate === "object" && data.candidate !== null);
  }
  return false;
}

function isMediaState(value: unknown): value is MediaState {
  if (typeof value !== "object" || value === null) return false;
  const media = value as Record<string, unknown>;
  return typeof media.audio === "boolean" && typeof media.video === "boolean" && typeof media.screen === "boolean";
}

/* -------------------------------------------------------------------------- */
/* Доска: состояние комнат                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Состояние доски урока живёт в памяти процесса сервера (как и участники
 * комнаты). Оно нужно, чтобы запоздавшие участники увидели уже нарисованное.
 */
interface WhiteboardRoomState {
  drawPolicy: WhiteboardDrawPolicy;
  /** Текущая общая страница (0-based). */
  page: number;
  /** `pages[i]` — Map<objectId, json объекта Fabric.js>. */
  pages: Map<string, Record<string, unknown>>[];
}

const whiteboardRooms = new Map<string, WhiteboardRoomState>();

function getWhiteboardState(roomId: string): WhiteboardRoomState {
  let state = whiteboardRooms.get(roomId);
  if (!state) {
    state = {
      drawPolicy: WHITEBOARD_DEFAULT_DRAW_POLICY,
      page: 0,
      pages: [new Map()],
    };
    whiteboardRooms.set(roomId, state);
  }
  return state;
}

function snapshotWhiteboard(state: WhiteboardRoomState): WhiteboardState {
  return {
    drawPolicy: state.drawPolicy,
    page: state.page,
    pages: state.pages.map((page) => ({ objects: Object.fromEntries(page) })),
  };
}

/** Рисовать может TEACHER/ADMIN всегда; STUDENT — только при политике `everyone`. */
function canDraw(socket: RealtimeSocket): boolean {
  const { roomId } = socket.data;
  const role = socket.data.user.role;
  if (role === "TEACHER" || role === "ADMIN") return true;
  if (!roomId) return false;
  return getWhiteboardState(roomId).drawPolicy === "everyone";
}

function isModerator(role: Role): boolean {
  return role === "TEACHER" || role === "ADMIN";
}

function isValidPage(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < WHITEBOARD_MAX_PAGES;
}

function isWhiteboardObjectPayload(value: unknown): value is WhiteboardObjectPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  if (typeof payload.id !== "string" || payload.id.length === 0 || payload.id.length > 64) return false;
  if (!isValidPage(payload.page)) return false;
  if (typeof payload.json !== "object" || payload.json === null || Array.isArray(payload.json)) return false;
  const type = (payload.json as Record<string, unknown>).type;
  if (typeof type !== "string" || type.length === 0) return false;
  try {
    return JSON.stringify(payload.json).length <= WHITEBOARD_MAX_OBJECT_JSON;
  } catch {
    return false;
  }
}

function isWhiteboardDeletePayload(value: unknown): value is WhiteboardDeletePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  if (!isValidPage(payload.page)) return false;
  return (
    Array.isArray(payload.objectIds) &&
    payload.objectIds.length > 0 &&
    payload.objectIds.length <= 100 &&
    payload.objectIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)
  );
}

function isWhiteboardClearPayload(value: unknown): value is WhiteboardClearPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return payload.page === "all" || isValidPage(payload.page);
}

function isWhiteboardCursorPayload(value: unknown): value is WhiteboardCursorPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    isValidPage(payload.page) &&
    typeof payload.x === "number" &&
    Number.isFinite(payload.x) &&
    payload.x >= 0 &&
    payload.x <= 1 &&
    typeof payload.y === "number" &&
    Number.isFinite(payload.y) &&
    payload.y >= 0 &&
    payload.y <= 1
  );
}

/** Обеспечивает наличие страниц 0..page включительно. */
function ensurePages(state: WhiteboardRoomState, page: number): void {
  while (state.pages.length <= page) state.pages.push(new Map());
}

function countObjects(state: WhiteboardRoomState): number {
  return state.pages.reduce((total, page) => total + page.size, 0);
}

/** Слоты частоты: чат, рисование и курсоры считаются отдельно. */
type RateSlot = "chat" | "wb" | "wbCursor";

function takeToken(socket: RealtimeSocket, slot: RateSlot, limit: number): boolean {
  const now = Date.now();
  const startKey = slot === "chat" ? "chatWindowStart" : slot === "wb" ? "wbWindowStart" : "wbCursorWindowStart";
  const countKey = slot === "chat" ? "chatCount" : slot === "wb" ? "wbCount" : "wbCursorCount";

  if (now - socket.data[startKey] >= 1000) {
    socket.data[startKey] = now;
    socket.data[countKey] = 0;
  }
  socket.data[countKey] += 1;
  return socket.data[countKey] <= limit;
}

/**
 * Счётчик участников в комнате: когда комната пустеет — забываем состояние
 * доски, чтобы не копить память между уроками.
 */
const roomMemberCounts = new Map<string, number>();

function addRoomMember(roomId: string): void {
  roomMemberCounts.set(roomId, (roomMemberCounts.get(roomId) ?? 0) + 1);
}

function removeRoomMember(roomId: string): void {
  const next = (roomMemberCounts.get(roomId) ?? 1) - 1;
  if (next <= 0) {
    roomMemberCounts.delete(roomId);
    whiteboardRooms.delete(roomId);
  } else {
    roomMemberCounts.set(roomId, next);
  }
}

/* -------------------------------------------------------------------------- */
/* Сервер                                                                      */
/* -------------------------------------------------------------------------- */

export function attachRealtime(httpServer: HttpServer): RealtimeServer {
  const io: RealtimeServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    path: SOCKET_PATH,
    maxHttpBufferSize: 256 * 1024,
    // Не рвём чужие upgrade-запросы (например, HMR Next.js в dev-режиме).
    destroyUpgrade: false,
  });

  io.use((socket, next) => {
    if (!isAllowedOrigin(socket.handshake.headers)) {
      next(new Error("FORBIDDEN_ORIGIN"));
      return;
    }

    authenticateHandshake(socket.handshake.headers)
      .then((user) => {
        if (!user) {
          next(new Error("UNAUTHORIZED"));
          return;
        }
        socket.data = {
          user,
          media: { ...DEFAULT_MEDIA_STATE },
          handRaised: false,
          chatWindowStart: 0,
          chatCount: 0,
          wbWindowStart: 0,
          wbCount: 0,
          wbCursorWindowStart: 0,
          wbCursorCount: 0,
        };
        next();
      })
      .catch(() => next(new Error("UNAUTHORIZED")));
  });

  io.on("connection", (socket: RealtimeSocket) => {
    socket.on("join-room", async (payload, ack) => {
      try {
        const roomId = payload?.roomId;
        if (!isValidRoomCode(roomId)) {
          reply<JoinRoomResult>(ack, { ok: false, code: "BAD_ROOM", error: "Некорректный код урока" });
          return;
        }

        const meeting = await findMeetingByCode(roomId);
        if (!meeting) {
          reply<JoinRoomResult>(ack, { ok: false, code: "NOT_FOUND", error: "Урок с таким кодом не найден" });
          return;
        }

        // Повторный вход (в ту же или другую комнату) — сначала выходим, чтобы
        // остальные получили user-left и не держали старый peer.
        leaveCurrentRoom(socket);

        socket.data.roomId = roomId;
        socket.data.meetingId = meeting.id;
        await socket.join(roomKey(roomId));
        addRoomMember(roomId);

        socket.to(roomKey(roomId)).emit("user-joined", toParticipant(socket));

        const [participants, history] = await Promise.all([
          listParticipants(io, roomId),
          loadRecentMessages(meeting.id),
        ]);

        reply<JoinRoomResult>(ack, {
          ok: true,
          data: { self: toParticipant(socket), participants, history },
        });
      } catch (error) {
        console.error("[realtime] join-room:", error);
        reply<JoinRoomResult>(ack, { ok: false, code: "INTERNAL", error: "Не удалось войти в урок" });
      }
    });

    socket.on("leave-room", () => {
      leaveCurrentRoom(socket);
    });

    socket.on("signal", (payload) => {
      const { roomId } = socket.data;
      const to = payload?.to;
      const data = payload?.data;
      if (!roomId || typeof to !== "string" || !isSignalData(data)) return;

      // Пересылаем только участнику из той же комнаты.
      const target = io.sockets.sockets.get(to);
      if (!target || target.data.roomId !== roomId) return;

      target.emit("signal", { from: socket.id, data });
    });

    socket.on("raise-hand", (payload) => {
      const { roomId } = socket.data;
      if (!roomId) return;

      socket.data.handRaised = Boolean(payload?.raised);
      io.in(roomKey(roomId)).emit("raise-hand", { socketId: socket.id, raised: socket.data.handRaised });
    });

    socket.on("media-state", (payload) => {
      const { roomId } = socket.data;
      if (!roomId || !isMediaState(payload)) return;

      socket.data.media = { audio: payload.audio, video: payload.video, screen: payload.screen };
      socket.to(roomKey(roomId)).emit("media-state", { socketId: socket.id, media: socket.data.media });
    });

    socket.on("chat-message", async (payload, ack) => {
      const { roomId, meetingId } = socket.data;
      if (!roomId || !meetingId) {
        reply(ack, { ok: false, code: "NOT_IN_ROOM", error: "Сначала войдите в урок" });
        return;
      }

      const ciphertext = payload?.ciphertext;
      if (typeof ciphertext !== "string" || ciphertext.length === 0 || ciphertext.length > CHAT_MAX_CIPHERTEXT_LENGTH) {
        reply(ack, { ok: false, code: "BAD_MESSAGE", error: "Сообщение пустое или слишком длинное" });
        return;
      }

      if (!takeChatToken(socket)) {
        reply(ack, { ok: false, code: "RATE_LIMIT", error: "Слишком много сообщений, подождите секунду" });
        return;
      }

      try {
        const envelope = await saveChatMessage({
          meetingId,
          userId: socket.data.user.id,
          ciphertext,
        });
        io.in(roomKey(roomId)).emit("chat-message", envelope);
        reply(ack, { ok: true, data: { id: envelope.id } });
      } catch (error) {
        console.error("[realtime] chat-message:", error);
        reply(ack, { ok: false, code: "SAVE_FAILED", error: "Не удалось отправить сообщение" });
      }
    });

    /* ------------------------------- Доска -------------------------------- */

    socket.on("whiteboard-add", (payload, ack) => {
      const { roomId } = socket.data;
      if (!roomId) {
        reply(ack, { ok: false, code: "NOT_IN_ROOM", error: "Сначала войдите в урок" });
        return;
      }
      if (!canDraw(socket)) {
        reply(ack, { ok: false, code: "FORBIDDEN", error: "Учитель ограничил рисование на доске" });
        return;
      }
      if (!takeToken(socket, "wb", WHITEBOARD_RATE_LIMIT_PER_SECOND)) {
        reply(ack, { ok: false, code: "RATE_LIMIT", error: "Слишком много изменений доски" });
        return;
      }
      if (!isWhiteboardObjectPayload(payload)) {
        reply(ack, { ok: false, code: "BAD_PAYLOAD", error: "Некорректный объект доски" });
        return;
      }

      const state = getWhiteboardState(roomId);
      ensurePages(state, payload.page);
      const page = state.pages[payload.page];
      if (!page.has(payload.id) && countObjects(state) >= WHITEBOARD_MAX_OBJECTS_PER_PAGE) {
        reply(ack, { ok: false, code: "LIMIT", error: "На доске слишком много объектов" });
        return;
      }

      page.set(payload.id, payload.json);
      socket.to(roomKey(roomId)).emit("whiteboard-add", payload);
      reply(ack, { ok: true, data: undefined });
    });

    socket.on("whiteboard-modify", (payload, ack) => {
      const { roomId } = socket.data;
      if (!roomId) {
        reply(ack, { ok: false, code: "NOT_IN_ROOM", error: "Сначала войдите в урок" });
        return;
      }
      if (!canDraw(socket)) {
        reply(ack, { ok: false, code: "FORBIDDEN", error: "Учитель ограничил рисование на доске" });
        return;
      }
      if (!takeToken(socket, "wb", WHITEBOARD_RATE_LIMIT_PER_SECOND)) {
        reply(ack, { ok: false, code: "RATE_LIMIT", error: "Слишком много изменений доски" });
        return;
      }
      if (!isWhiteboardObjectPayload(payload)) {
        reply(ack, { ok: false, code: "BAD_PAYLOAD", error: "Некорректный объект доски" });
        return;
      }

      const state = getWhiteboardState(roomId);
      ensurePages(state, payload.page);
      state.pages[payload.page].set(payload.id, payload.json);
      socket.to(roomKey(roomId)).emit("whiteboard-modify", payload);
      reply(ack, { ok: true, data: undefined });
    });

    socket.on("whiteboard-delete", (payload, ack) => {
      const { roomId } = socket.data;
      if (!roomId) {
        reply(ack, { ok: false, code: "NOT_IN_ROOM", error: "Сначала войдите в урок" });
        return;
      }
      if (!canDraw(socket)) {
        reply(ack, { ok: false, code: "FORBIDDEN", error: "Учитель ограничил рисование на доске" });
        return;
      }
      if (!takeToken(socket, "wb", WHITEBOARD_RATE_LIMIT_PER_SECOND)) {
        reply(ack, { ok: false, code: "RATE_LIMIT", error: "Слишком много изменений доски" });
        return;
      }
      if (!isWhiteboardDeletePayload(payload)) {
        reply(ack, { ok: false, code: "BAD_PAYLOAD", error: "Некорректное удаление" });
        return;
      }

      const state = getWhiteboardState(roomId);
      if (isValidPage(payload.page) && payload.page < state.pages.length) {
        const page = state.pages[payload.page];
        for (const id of payload.objectIds) page.delete(id);
      }
      socket.to(roomKey(roomId)).emit("whiteboard-delete", payload);
      reply(ack, { ok: true, data: undefined });
    });

    socket.on("whiteboard-clear", (payload, ack) => {
      const { roomId } = socket.data;
      if (!roomId) {
        reply(ack, { ok: false, code: "NOT_IN_ROOM", error: "Сначала войдите в урок" });
        return;
      }
      if (!canDraw(socket)) {
        reply(ack, { ok: false, code: "FORBIDDEN", error: "Учитель ограничил рисование на доске" });
        return;
      }
      if (!takeToken(socket, "wb", WHITEBOARD_RATE_LIMIT_PER_SECOND)) {
        reply(ack, { ok: false, code: "RATE_LIMIT", error: "Слишком много изменений доски" });
        return;
      }
      if (!isWhiteboardClearPayload(payload)) {
        reply(ack, { ok: false, code: "BAD_PAYLOAD", error: "Некорректная очистка" });
        return;
      }

      const state = getWhiteboardState(roomId);
      if (payload.page === "all") {
        state.pages = [new Map()];
        state.page = 0;
      } else if (payload.page < state.pages.length) {
        state.pages[payload.page] = new Map();
      }
      socket.to(roomKey(roomId)).emit("whiteboard-clear", payload);
      reply(ack, { ok: true, data: undefined });
    });

    socket.on("whiteboard-cursor", (payload) => {
      const { roomId } = socket.data;
      if (!roomId || !isWhiteboardCursorPayload(payload)) return;
      if (!takeToken(socket, "wbCursor", WHITEBOARD_CURSOR_RATE_LIMIT_PER_SECOND)) return;

      socket.to(roomKey(roomId)).emit("whiteboard-cursor", {
        socketId: socket.id,
        name: socket.data.user.name,
        page: payload.page,
        x: payload.x,
        y: payload.y,
      });
    });

    socket.on("whiteboard-access", (payload, ack) => {
      const { roomId } = socket.data;
      if (!roomId) {
        reply(ack, { ok: false, code: "NOT_IN_ROOM", error: "Сначала войдите в урок" });
        return;
      }
      if (!isModerator(socket.data.user.role)) {
        reply(ack, { ok: false, code: "FORBIDDEN", error: "Менять права доски может только учитель" });
        return;
      }

      const drawPolicy = payload?.drawPolicy;
      if (drawPolicy !== "moderators" && drawPolicy !== "everyone") {
        reply(ack, { ok: false, code: "BAD_PAYLOAD", error: "Некорректная политика доступа" });
        return;
      }

      const state = getWhiteboardState(roomId);
      state.drawPolicy = drawPolicy;
      // Политика рассылается всем, включая инициатора, — UI остаётся единым.
      io.in(roomKey(roomId)).emit("whiteboard-access", { drawPolicy });
      reply(ack, { ok: true, data: undefined });
    });

    socket.on("whiteboard-page", (payload, ack) => {
      const { roomId } = socket.data;
      if (!roomId) {
        reply(ack, { ok: false, code: "NOT_IN_ROOM", error: "Сначала войдите в урок" });
        return;
      }
      if (!canDraw(socket)) {
        reply(ack, { ok: false, code: "FORBIDDEN", error: "Учитель ограничил управление доской" });
        return;
      }
      if (!payload || !isValidPage(payload.page)) {
        reply(ack, { ok: false, code: "BAD_PAYLOAD", error: "Некорректная страница" });
        return;
      }

      const state = getWhiteboardState(roomId);
      ensurePages(state, payload.page);
      state.page = payload.page;
      io.in(roomKey(roomId)).emit("whiteboard-page", { page: payload.page });
      reply(ack, { ok: true, data: undefined });
    });

    socket.on("whiteboard-sync", (_payload, ack) => {
      const { roomId } = socket.data;
      if (!roomId) {
        reply<WhiteboardState>(ack, { ok: false, code: "NOT_IN_ROOM", error: "Сначала войдите в урок" });
        return;
      }
      reply<WhiteboardState>(ack, {
        ok: true,
        data: snapshotWhiteboard(getWhiteboardState(roomId)),
      });
    });

    socket.on("disconnect", () => {
      leaveCurrentRoom(socket);
    });
  });

  return io;
}
