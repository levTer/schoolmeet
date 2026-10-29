import type { Role } from "@/types";

/** Pure authorization rules shared by the API route, signaling handler, UI, and tests. */
export interface CallActor {
  id: string;
  role?: Role | null;
  schoolId: string | null;
  isBanned?: boolean;
}

export interface CallOwnership {
  hostId: string | null;
  schoolId: string | null;
}

/** Only the actual meeting host or an ADMIN of the same school may end a call for all. */
export function canEndCallForAll(actor: CallActor, meeting: CallOwnership): boolean {
  if (!actor.id || !actor.schoolId || !meeting.schoolId) return false;
  if (actor.schoolId !== meeting.schoolId || actor.isBanned) return false;
  return Boolean((meeting.hostId && actor.id === meeting.hostId) || actor.role === "ADMIN");
}

/** UI permission check for banner/room controls once tenant access is already verified. */
export function canManageLessonEnd(
  currentUser: { id: string; role: Role } | null | undefined,
  lesson: { hostId?: string | null },
): boolean {
  if (!currentUser?.id) return false;
  if (currentUser.role === "ADMIN") return true;
  return Boolean(lesson.hostId && currentUser.id === lesson.hostId);
}

export function participantCount(participants: readonly { userId: string }[]): number {
  return new Set(participants.map((p) => p.userId)).size;
}
