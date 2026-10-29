import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { MeetingsBoard } from "@/components/admin/meetings-board";
import { FormAlert } from "@/components/ui/form-alert";
import { canAdmin } from "@/lib/admin-permissions";
import { listActiveMeetings, type ActiveMeetingsSummary } from "@/lib/admin-meetings";
import { listAttendance, type AttendanceRow } from "@/lib/attendance";
import { authOptions } from "@/lib/auth";
import { getLiveAdminViewer } from "@/lib/session-viewer";

export const metadata: Metadata = {
  title: "Активные уроки",
  description: "Текущие видеоуроки Лицея Сингулярити и посещаемость: кто вошёл, когда вышел и сколько пробыл.",
};

export const dynamic = "force-dynamic";

/**
 * `/admin/meetings` — живые уроки и журнал посещаемости.
 *
 * Сервер отдаёт первый срез (участники из Socket.IO-реестра + записи из БД),
 * клиент дальше обновляет данные раз в 10 секунд.
 */
export default async function AdminMeetingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/admin/meetings");

  const admin = await getLiveAdminViewer();
  if (!admin) redirect("/dashboard?denied=admin");

  let meetings: ActiveMeetingsSummary | null = null;
  let attendance: { items: AttendanceRow[]; total: number } | null = null;

  try {
    [meetings, attendance] = await Promise.all([
      listActiveMeetings(admin.schoolId),
      listAttendance({ schoolId: admin.schoolId, limit: 25 }),
    ]);
  } catch (error) {
    console.error("[admin/meetings] Не удалось загрузить уроки:", error);
  }

  if (!meetings || !attendance) {
    return (
      <FormAlert variant="error">
        Не удалось загрузить данные об уроках и посещаемости. Проверьте доступность базы данных.
      </FormAlert>
    );
  }

  const actor = { id: admin.id, role: admin.role };

  return (
    <MeetingsBoard
      initialMeetings={meetings}
      initialAttendance={{ items: attendance.items, total: attendance.total }}
      actor={actor}
      canViewAttendance={canAdmin(actor, "attendance.view")}
    />
  );
}
