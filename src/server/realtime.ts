import type { IncomingHttpHeaders, Server as HttpServer } from "node:http";
import { getToken } from "next-auth/jwt";
import { Server, type Socket } from "socket.io";

import {
  CHAT_MAX_CIPHERTEXT_LENGTH,
  CHAT_RATE_LIMIT_PER_SECOND,
  DEFAULT_MEDIA_STATE,
  SDP_MAX_LENGTH,
  SOCKET_PATH,
  isValidRoomCode,
  type Ack,
  type ClientToServerEvents,
  type JoinRoomResult,
  type MediaState,
  type RoomParticipant,
  type ServerToClientEvents,
  type SignalData,
  type SocketUser,
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
}

function reply<T>(ack: unknown, result: Ack<T>): void {
  if (typeof ack === "function") (ack as (value: Ack<T>) => void)(result);
}

/** Простой лимит на частоту сообщений: не больше N сообщений в секунду. */
function takeChatToken(socket: RealtimeSocket): boolean {
  const now = Date.now();
  if (now - socket.data.chatWindowStart >= 1000) {
    socket.data.chatWindowStart = now;
    socket.data.chatCount = 0;
  }
  socket.data.chatCount += 1;
  return socket.data.chatCount <= CHAT_RATE_LIMIT_PER_SECOND;
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

    socket.on("disconnect", () => {
      leaveCurrentRoom(socket);
    });
  });

  return io;
}
