import { prisma } from "@/lib/prisma";
import { closeMeetingAttendance } from "@/lib/attendance";
import { getRealtimeControl, type LiveParticipant } from "@/lib/realtime-control";
import { GRADE_LABELS, type GradeCode } from "@/lib/schedule-rules";
import type { Role } from "@/types";

/**
 * Активные видеоуроки для админ-панели (`/admin/meetings`).
 *
 * «Активный урок» — тот, где прямо сейчас есть участники (реестр Socket.IO),
 * либо есть незакрытая запись посещаемости за последние часы. Занятие, которое
 * уже завершили, из списка исчезает.
 */

/** Окно «свежести»: после него незакрытая запись считается зависшей. */
const ACTIVE_WINDOW_MS = 6 * 60 * 60_000;

/** Урок уже завершён, если `endTime` не старше этого времени. */
const CLOSED_COOLDOWN_MS = 30 * 60_000;

export interface ActiveMeetingRow {
  id: string;
  title: string;
  meetingCode: string;
  host: { id: string; name: string; role: Role };
  /** Класс: из расписания либо по большинству участников-учеников. */
  grade: GradeCode | null;
  gradeLabel: string | null;
  subject: string | null;
  startedAt: string;
  /** Идёт ли урок прямо сейчас (есть подключённые сокеты). */
  isLive: boolean;
  participants: { total: number; students: number; teachers: number };
  /** Сколько записей посещаемости всего по этому уроку. */
  attendanceTotal: number;
}

export interface ActiveMeetingsSummary {
  items: ActiveMeetingRow[];
  totals: { meetings: number; liveMeetings: number; students: number; participants: number };
}

function majorityStudentGrade(grades: (GradeCode | null)[]): GradeCode | null {
  const counts = new Map<GradeCode, number>();
  for (const grade of grades) {
    if (!grade) continue;
    counts.set(grade, (counts.get(grade) ?? 0) + 1);
  }

  let best: GradeCode | null = null;
  let bestCount = 0;

  counts.forEach((count, grade) => {
    if (count > bestCount) {
      best = grade;
      bestCount = count;
    }
  });

  return best;
}

/** Список текущих уроков: кто ведёт, какой класс и предмет, сколько в комнате. */
export async function listActiveMeetings(schoolId: string): Promise<ActiveMeetingsSummary> {
  const control = getRealtimeControl();
  const liveRooms = control?.listLiveRooms() ?? [];

  const liveByMeeting = new Map<string, { roomId: string; participants: LiveParticipant[] }>();
  liveRooms.forEach((room) => {
    if (!room.meetingId) return;
    liveByMeeting.set(room.meetingId, { roomId: room.roomId, participants: room.participants });
  });

  const now = Date.now();

  const meetings = await prisma.meeting.findMany({
    where: {
      schoolId,
      OR: [
        { id: { in: Array.from(liveByMeeting.keys()) } },
        {
          endTime: null,
          attendance: { some: { leftAt: null, joinedAt: { gte: new Date(now - ACTIVE_WINDOW_MS) } } },
        },
        { endTime: null, isActive: true },
      ],
    },
    orderBy: { startTime: "desc" },
    take: 50,
    include: {
      host: { select: { id: true, name: true, role: true } },
      schedule: {
        select: { grade: true, room: true, subject: { select: { name: true } } },
      },
      attendance: {
        where: { leftAt: null },
        select: {
          joinedAt: true,
          user: { select: { id: true, name: true, role: true, grade: true } },
        },
      },
      _count: { select: { attendance: true } },
    },
  });

  const items: ActiveMeetingRow[] = meetings.map((meeting) => {
    const live = liveByMeeting.get(meeting.id);
    const liveParticipants = live?.participants ?? [];
    const openRecords = meeting.attendance;

    const studentGrades = liveParticipants.length > 0
      ? liveParticipants
          .filter((participant) => participant.role === "STUDENT")
          .map((participant) => participant.grade)
      : openRecords
          .filter((record) => record.user.role === "STUDENT")
          .map((record) => (record.user.grade as GradeCode | null) ?? null);

    const grade = (meeting.schedule?.grade as GradeCode | null) ?? majorityStudentGrade(studentGrades);

    return {
      id: meeting.id,
      title: meeting.title,
      meetingCode: meeting.meetingCode,
      host: { id: meeting.host.id, name: meeting.host.name, role: meeting.host.role as Role },
      grade,
      gradeLabel: grade ? GRADE_LABELS[grade] : null,
      subject: meeting.schedule?.subject.name ?? null,
      startedAt: meeting.startTime.toISOString(),
      isLive: liveParticipants.length > 0,
      participants: {
        total: liveParticipants.length || openRecords.length,
        students:
          liveParticipants.length > 0
            ? liveParticipants.filter((participant) => participant.role === "STUDENT").length
            : openRecords.filter((record) => record.user.role === "STUDENT").length,
        teachers:
          liveParticipants.length > 0
            ? liveParticipants.filter((participant) => participant.role !== "STUDENT").length
            : openRecords.filter((record) => record.user.role !== "STUDENT").length,
      },
      attendanceTotal: meeting._count.attendance,
    };
  });

  return {
    items,
    totals: {
      meetings: items.length,
      liveMeetings: items.filter((item) => item.isLive).length,
      students: items.reduce((total, item) => total + item.participants.students, 0),
      participants: items.reduce((total, item) => total + item.participants.total, 0),
    },
  };
}

export interface ForceEndResult {
  meetingId: string;
  roomIds: string[];
  /** Сколько сокетов выкинули из комнаты. */
  closedSockets: number;
  /** Сколько записей посещаемости закрыли в БД. */
  closedAttendance: number;
  /** Урок уже был завершён раньше. */
  alreadyClosed: boolean;
  /** Сколько человек предупредили, но не смогли отключить (нет реестра в процессе). */
  controlAvailable: boolean;
}

/**
 * Принудительно завершает урок: рассылает `room-closed`, выводит всех из
 * комнаты, закрывает посещаемость и помечает урок завершённым.
 *
 * Возвращает статистику отключения — она попадает в уведомление админа и в журнал.
 */
export async function forceEndMeeting(meetingId: string): Promise<ForceEndResult> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, endTime: true },
  });
  if (!meeting) {
    throw new Error("MEETING_NOT_FOUND");
  }

  const alreadyClosed = Boolean(meeting.endTime && Date.now() - meeting.endTime.getTime() < CLOSED_COOLDOWN_MS);
  const now = new Date();

  const control = getRealtimeControl();
  const closed = control
    ? control.closeMeeting(meetingId, {
        reason: "admin_force_end",
        message: "Администратор завершил урок. Комната закрыта.",
      })
    : { closedSockets: 0, roomIds: [] as string[] };

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { isActive: false, endTime: now, status: "ended" },
  });

  const closedAttendance = await closeMeetingAttendance(meetingId, now);

  return {
    meetingId,
    roomIds: closed.roomIds,
    closedSockets: closed.closedSockets,
    closedAttendance,
    alreadyClosed,
    controlAvailable: control !== null,
  };
}
