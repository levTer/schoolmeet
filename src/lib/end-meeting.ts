import { schoolScope } from "@/lib/admin-tenant";
import { DomainError, forbidden, notFound } from "@/lib/api";
import { closeMeetingAttendance } from "@/lib/attendance";
import { withRoomLock } from "@/lib/call-room";
import { canEndCallForAll } from "@/lib/call-rules";
import { prisma } from "@/lib/prisma";
import { getRealtimeControl } from "@/lib/realtime-control";
import type { Role } from "@/types";

export interface EndMeetingActor {
  id: string;
  name?: string | null;
  role: Role;
  schoolId: string;
  isBanned?: boolean;
}

export interface EndMeetingOutcome {
  meetingId: string;
  meetingCode: string;
  title: string;
  status: "ended";
  endedAt: string;
  alreadyEnded: boolean;
  closedSockets: number;
  closedAttendance: number;
}

interface ScopedMeetingRow {
  id: string;
  title: string;
  meetingCode: string;
  hostId: string;
  schoolId: string | null;
  status: "idle" | "active" | "ended";
  isActive: boolean;
  endTime: Date | null;
}

/**
 * Завершает активный или открытый урок для всех участников школы.
 *
 * Проверяет изоляцию арендатора (`schoolId`) и права вызывающего (`hostId`
 * либо роль `ADMIN`), атомарно переводит комнату в `status = "ended"`,
 * рассылает WebSocket-событие `CALL_ENDED` и закрывает посещаемость.
 */
export async function endMeetingByActor(
  identifier: string,
  actor: EndMeetingActor,
): Promise<EndMeetingOutcome> {
  const trimmed = typeof identifier === "string" ? identifier.trim() : "";
  if (!trimmed) {
    throw new DomainError(400, "BAD_REQUEST", "Не указан идентификатор урока");
  }

  const tenant = schoolScope(actor.schoolId);
  if (actor.isBanned) {
    throw new DomainError(403, "ACCOUNT_BANNED", "Аккаунт заблокирован администратором");
  }

  const meeting = (await prisma.meeting.findFirst({
    where: {
      OR: [{ id: trimmed }, { meetingCode: trimmed }],
      ...tenant,
    },
    select: {
      id: true,
      title: true,
      meetingCode: true,
      hostId: true,
      schoolId: true,
      status: true,
      isActive: true,
      endTime: true,
    },
  })) as ScopedMeetingRow | null;

  if (!meeting || !meeting.schoolId || meeting.schoolId !== tenant.schoolId) {
    throw notFound("Урок не найден");
  }

  if (
    !canEndCallForAll(
      { id: actor.id, role: actor.role, schoolId: tenant.schoolId, isBanned: actor.isBanned },
      { hostId: meeting.hostId, schoolId: meeting.schoolId },
    )
  ) {
    throw forbidden("Завершить урок может только организатор или администратор школы");
  }

  let actorName = actor.name?.trim() || "";
  if (!actorName) {
    const dbUser = (await prisma.user.findFirst({
      where: { id: actor.id, ...tenant },
      select: { name: true },
    })) as { name: string | null } | null;
    actorName = dbUser?.name?.trim() || "Организатор";
  }

  return withRoomLock(meeting.id, async () => {
    const endedAt = new Date();
    const alreadyEnded = meeting.status === "ended" && meeting.endTime !== null && !meeting.isActive;

    const updated = (await prisma.meeting.updateMany({
      where: { id: meeting.id, ...tenant },
      data: {
        status: "ended",
        isActive: false,
        endTime: endedAt,
      },
    })) as { count: number };

    if (updated.count === 0) {
      throw notFound("Урок не найден");
    }

    const control = getRealtimeControl();
    const realtimeResult = control
      ? control.endCallForAll({
          schoolId: tenant.schoolId,
          meetingId: meeting.id,
          meetingCode: meeting.meetingCode,
          endedBy: { id: actor.id, name: actorName },
          endedAt: endedAt.toISOString(),
        })
      : { closedSockets: 0, roomId: "" };

    let closedAttendance = 0;
    try {
      closedAttendance = await closeMeetingAttendance(meeting.id, tenant.schoolId, endedAt);
    } catch (error) {
      console.error("[end-meeting] close attendance after end:", error);
    }

    return {
      meetingId: meeting.id,
      meetingCode: meeting.meetingCode,
      title: meeting.title,
      status: "ended",
      endedAt: endedAt.toISOString(),
      alreadyEnded,
      closedSockets: realtimeResult.closedSockets,
      closedAttendance,
    };
  });
}
