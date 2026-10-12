import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { MeetingsBoard } from "@/components/admin/meetings-board";
import { FormAlert } from "@/components/ui/form-alert";
import { canAdmin } from "@/lib/admin-permissions";
import { listActiveMeetings, type ActiveMeetingsSummary } from "@/lib/admin-meetings";
import { listAttendance, type AttendanceRow } from "@/lib/attendance";
import { authOptions, canAccessAdminArea } from "@/lib/auth";
import { getSchoolViewer } from "@/lib/school-viewer";

export const metadata: Metadata = {
  title: "Активные уроки",
  description: "Текущие видеоуроки SchoolMeet и посещаемость: кто вошёл, когда вышел и сколько пробыл.",
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
  if (!canAccessAdminArea(session.user.role)) redirect("/dashboard?denied=admin");

  let meetings: ActiveMeetingsSummary | null = null;
  let attendance: { items: AttendanceRow[]; total: number } | null = null;

  try {
    const viewer = await getSchoolViewer(session.user.id);
    if (viewer?.schoolId) {
      [meetings, attendance] = await Promise.all([
        listActiveMeetings(viewer.schoolId),
        listAttendance({ schoolId: viewer.schoolId, limit: 25 }),
      ]);
    }
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

  const actor = { id: session.user.id, role: session.user.role };

  return (
    <MeetingsBoard
      initialMeetings={meetings}
      initialAttendance={{ items: attendance.items, total: attendance.total }}
      actor={actor}
      canViewAttendance={canAdmin(actor, "attendance.view")}
    />
  );
}
