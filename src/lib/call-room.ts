import { isValidRoomCode } from "@/lib/realtime";

export function buildLobbyRoomId(schoolId: string): string {
  return `lobby:${schoolId}`;
}

export function parseSchoolRoomId(roomId: string, schoolId: string): string | null {
  const parts = roomId.split(":");
  if (parts.length !== 3 || parts[0] !== "room" || parts[1] !== schoolId || !isValidRoomCode(parts[2])) return null;
  return parts[2];
}

/** Serializes join/end/idle transitions for one meeting inside this process. */
const roomLocks = new Map<string, Promise<unknown>>();
export function withRoomLock<T>(meetingId: string, task: () => Promise<T>): Promise<T> {
  const previous = roomLocks.get(meetingId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  roomLocks.set(meetingId, next);
  void next.finally(() => {
    if (roomLocks.get(meetingId) === next) roomLocks.delete(meetingId);
  }).catch(() => undefined);
  return next;
}
