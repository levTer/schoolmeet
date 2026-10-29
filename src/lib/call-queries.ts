import { prisma } from "@/lib/prisma";
import { getRealtimeControl } from "@/lib/realtime-control";
import { checkMeetingAccess } from "@/lib/meetings";
import { participantCount } from "@/lib/call-rules";
import type { ActiveCall } from "@/lib/realtime";
import type { SchoolViewer } from "@/lib/school-viewer";

/** Active calls visible to a viewer, based on live signaling memberships. */
export async function listActiveCallsForViewer(viewer: SchoolViewer): Promise<ActiveCall[]> {
  if (!viewer.schoolId) return [];
  const control = getRealtimeControl();
  const liveRooms = control?.listLiveRooms() ?? [];
  const ids = liveRooms.map((room) => room.meetingId).filter((id): id is string => Boolean(id));
  if (!ids.length) return [];
  const meetings = await prisma.meeting.findMany({
    where: { id: { in: ids }, schoolId: viewer.schoolId, status: { not: "ended" } },
    include: {
      host: { select: { id: true, name: true, role: true, schoolId: true } },
      schedule: { select: { schoolId: true, classId: true } },
      school: { select: { id: true, strictClassIsolation: true } },
    },
  });
  const liveByMeeting = new Map(liveRooms.filter((r) => r.meetingId).map((r) => [r.meetingId!, r]));
  const result: ActiveCall[] = [];
  for (const meeting of meetings) {
    const decision = checkMeetingAccess(meeting, {
      id: viewer.id, role: viewer.role, schoolId: viewer.schoolId, classId: viewer.classId,
    });
    if (!decision.ok) continue;
    const live = liveByMeeting.get(meeting.id);
    if (!live || live.participants.length === 0) continue;
    result.push({
      roomId: live.roomId,
      meetingId: meeting.id,
      meetingCode: meeting.meetingCode,
      title: meeting.title,
      hostId: meeting.hostId,
      hostName: meeting.host.name,
      startedAt: (meeting.callStartedAt ?? (live.startedAt ? new Date(live.startedAt) : meeting.startTime)).toISOString(),
      participantCount: participantCount(live.participants),
    });
  }
  return result.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
