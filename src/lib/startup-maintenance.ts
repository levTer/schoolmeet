import { finishAllStaleAttendance, releaseStaleMeetings } from "@/lib/attendance";

/**
 * Обслуживание БД при старте процесса.
 *
 * В памяти процесса живут комнаты, доска, посещаемость и счётчики — поэтому
 * падение или редеплой оставляют «хвосты» в PostgreSQL:
 *  - записи посещаемости без `leftAt` → фантомы в отчётах и «кто на уроке»;
 *  - уроки со `status = "active"` без сокетов → фантомы в лобби.
 *
 * Здесь хвосты закрываются один раз при старте. Операции идемпотентны, идут
 * батчами и никогда не роняют запуск сервера: это обслуживание, а не условие
 * работоспособности.
 */
export interface StartupMaintenanceResult {
  closedAttendance: number;
  releasedMeetings: number;
}

export async function runStartupMaintenance(now: Date = new Date()): Promise<StartupMaintenanceResult> {
  const [closedAttendance, releasedMeetings] = await Promise.all([
    finishAllStaleAttendance(now),
    releaseStaleMeetings(now),
  ]);
  return { closedAttendance, releasedMeetings };
}
