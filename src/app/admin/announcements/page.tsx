import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { AnnouncementsManager } from "@/components/admin/announcements-manager";
import { FormAlert } from "@/components/ui/form-alert";
import { canAdmin } from "@/lib/admin-permissions";
import { listAnnouncements, type AnnouncementDto } from "@/lib/announcements";
import { authOptions, canAccessAdminArea } from "@/lib/auth";
import { getSchoolViewer } from "@/lib/school-viewer";

export const metadata: Metadata = {
  title: "Объявления",
  description: "Общешкольные объявления Лицея Сингулярити: публикация для всей школы или отдельного класса.",
};

export const dynamic = "force-dynamic";

/**
 * `/admin/announcements` — управление объявлениями.
 *
 * Создавать и снимать объявления может только ADMIN (раздел /admin закрыт для
 * учителей и учеников); активные объявления
 * показываются плавающим баннером в `/dashboard`.
 */
export default async function AdminAnnouncementsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/admin/announcements");
  if (!canAccessAdminArea(session.user.role)) redirect("/dashboard?denied=admin");

  // Школа — только из «живой» сессии: роль и tenant перечитываются из БД,
  // поэтому страница не выдаст объявления чужой школы по устаревшему JWT.
  const viewer = await getSchoolViewer(session.user.id);

  if (!viewer?.schoolId) {
    return (
      <FormAlert variant="error">
        Аккаунт не привязан к школе: управление объявлениями недоступно.
      </FormAlert>
    );
  }

  let announcements: AnnouncementDto[] | null = null;
  try {
    announcements = await listAnnouncements({ schoolId: viewer.schoolId, take: 100 });
  } catch (error) {
    console.error("[admin/announcements] Не удалось загрузить объявления:", error);
  }

  if (!announcements) {
    return (
      <FormAlert variant="error">
        Не удалось загрузить объявления. Проверьте доступность базы данных.
      </FormAlert>
    );
  }

  return (
    <AnnouncementsManager
      initial={announcements}
      canManage={canAdmin({ id: viewer.id, role: viewer.role }, "announcements.manage")}
    />
  );
}
