import type { Server, Socket } from "socket.io";

import { canEndCallForAll } from "@/lib/call-rules";
import { buildLobbyRoomId, parseSchoolRoomId, withRoomLock } from "@/lib/call-room";
import { closeMeetingAttendance } from "@/lib/attendance";
import { findMeetingByCode } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";
import {
  buildSchoolRoomId,
  type Ack,
  type CallEndedPayload,
  type ClientToServerEvents,
  type EndCallResult,
  type ServerToClientEvents,
} from "@/lib/realtime";
import type { MediaState, SocketUser } from "@/lib/realtime";

/**
 * Host-only call termination and lobby presence.
 *
 * The signaling server does not own RTCPeerConnection or TURN allocations:
 * those live in browsers and the TURN provider. Ending a call therefore (1)
 * commits `status=ended` in the DB, (2) broadcasts CALL_ENDED so every browser
 * closes its PCs/tracks, and (3) removes all signaling memberships and room
 * state. Late signals are rejected because socket.data.roomId is cleared.
 */
export interface CallSocketData {
  user: SocketUser;
  roomId?: string;
  meetingId?: string;
  meetingTitle?: string;
  attendanceId?: string;
  joinedAt?: number;
  media: MediaState;
  handRaised: boolean;
  chatWindowStart: number;
  chatCount: number;
  wbWindowStart: number;
  wbCount: number;
  wbCursorWindowStart: number;
  wbCursorCount: number;
  typingLastSentAt: number;
  endCallWindowStart: number;
  endCallCount: number;
}

type CallServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, CallSocketData>;
type CallSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, CallSocketData>;

function reply<T>(ack: unknown, result: Ack<T>): void {
  if (typeof ack === "function") (ack as (value: Ack<T>) => void)(result);
}

function roomSockets(io: CallServer, roomId: string): CallSocket[] {
  const ids = io.sockets.adapter.rooms.get(roomId);
  if (!ids) return [];
  const result: CallSocket[] = [];
  ids.forEach((id) => {
    const socket = io.sockets.sockets.get(id);
    if (socket) result.push(socket);
  });
  return result;
}

export interface CallHandlerDeps {
  io: CallServer;
  socket: CallSocket;
  leaveCurrentRoom: (socket: CallSocket) => void;
  clearRoomState: (roomId: string) => void;
}

export function registerCallHandlers({ io, socket, leaveCurrentRoom, clearRoomState }: CallHandlerDeps): void {
  socket.on("watch-lobby", (ack) => {
    void Promise.resolve(socket.join(buildLobbyRoomId(socket.data.user.schoolId))).then(() => {
      reply(ack, { ok: true, data: undefined });
    }).catch(() => {
      reply(ack, { ok: false, code: "INTERNAL", error: "Не удалось подписаться на звонки" });
    });
  });

  socket.on("END_CALL_FOR_ALL", async (payload, ack) => {
    const now = Date.now();
    if (now - socket.data.endCallWindowStart >= 1000) {
      socket.data.endCallWindowStart = now;
      socket.data.endCallCount = 0;
    }
    socket.data.endCallCount += 1;
    if (socket.data.endCallCount > 2) {
      reply<EndCallResult>(ack, { ok: false, code: "RATE_LIMIT", error: "Слишком много запросов на завершение" });
      return;
    }

    const requestedRoomId = typeof payload?.roomId === "string" ? payload.roomId : null;
    if (requestedRoomId && socket.data.roomId && requestedRoomId !== socket.data.roomId) {
      reply<EndCallResult>(ack, { ok: false, code: "BAD_PAYLOAD", error: "Нельзя завершить другую комнату из этого звонка" });
      return;
    }
    const roomId = requestedRoomId ?? socket.data.roomId;
    if (!roomId) {
      reply<EndCallResult>(ack, { ok: false, code: "NOT_IN_ROOM", error: "Укажите комнату звонка" });
      return;
    }
    const meetingCode = parseSchoolRoomId(roomId, socket.data.user.schoolId);
    if (!meetingCode) {
      reply<EndCallResult>(ack, { ok: false, code: "FORBIDDEN", error: "Комната недоступна" });
      return;
    }

    try {
      const [meeting, actor] = await Promise.all([
        findMeetingByCode(meetingCode),
        prisma.user.findUnique({ where: { id: socket.data.user.id }, select: { id: true, name: true, schoolId: true, isBanned: true } }),
      ]);
      if (!meeting || meeting.schoolId !== socket.data.user.schoolId || buildSchoolRoomId(meeting.schoolId, meeting.meetingCode) !== roomId) {
        reply<EndCallResult>(ack, { ok: false, code: "NOT_FOUND", error: "Звонок не найден" });
        return;
      }
      if (!actor || !canEndCallForAll(actor, meeting)) {
        reply<EndCallResult>(ack, { ok: false, code: "FORBIDDEN", error: "Завершить звонок для всех может только организатор" });
        return;
      }

      await withRoomLock(meeting.id, async () => {
        const endedAt = new Date();
        const updated = await prisma.meeting.updateMany({
          where: { id: meeting.id, hostId: actor.id, schoolId: actor.schoolId, status: { not: "ended" } },
          data: { status: "ended", isActive: false, endTime: endedAt },
        });
        const targets = roomSockets(io, roomId);
        if (updated.count === 0 && targets.length === 0) {
          reply<EndCallResult>(ack, { ok: true, data: { meetingId: meeting.id, endedAt: (meeting.endTime ?? endedAt).toISOString(), alreadyEnded: true } });
          return;
        }

        const event: CallEndedPayload = {
          roomId,
          meetingId: meeting.id,
          meetingCode: meeting.meetingCode,
          endedBy: { id: actor.id, name: actor.name },
          endedAt: endedAt.toISOString(),
          reason: "host_ended",
        };
        // Broadcast before removing memberships so every current participant gets it.
        io.in(roomId).emit("CALL_ENDED", event);
        targets.forEach((target) => leaveCurrentRoom(target));
        clearRoomState(roomId);
        io.to(buildLobbyRoomId(actor.schoolId!)).emit("ACTIVE_CALLS_CHANGED");

        try {
          await closeMeetingAttendance(meeting.id, actor.schoolId!, endedAt);
        } catch (error) {
          // The call is already ended; attendance repair must not revive it.
          console.error("[calls] close attendance after end:", error);
        }
        reply<EndCallResult>(ack, { ok: true, data: { meetingId: meeting.id, endedAt: endedAt.toISOString(), alreadyEnded: updated.count === 0 } });
      });
    } catch (error) {
      console.error("[calls] END_CALL_FOR_ALL:", error);
      reply<EndCallResult>(ack, { ok: false, code: "INTERNAL", error: "Не удалось завершить звонок. Попробуйте ещё раз." });
    }
  });
}
