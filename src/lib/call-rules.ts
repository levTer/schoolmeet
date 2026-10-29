/** Pure authorization rules shared by the signaling handler and tests. */
export interface CallActor {
  id: string;
  schoolId: string | null;
  isBanned?: boolean;
}
export interface CallOwnership {
  hostId: string;
  schoolId: string | null;
}

/** Only the actual host may END_CALL_FOR_ALL; a TEACHER/ADMIN role is not enough. */
export function canEndCallForAll(actor: CallActor, meeting: CallOwnership): boolean {
  return Boolean(
    actor.id && actor.schoolId && meeting.schoolId &&
    actor.schoolId === meeting.schoolId && actor.id === meeting.hostId && !actor.isBanned,
  );
}

export function participantCount(participants: readonly { userId: string }[]): number {
  return new Set(participants.map((p) => p.userId)).size;
}
