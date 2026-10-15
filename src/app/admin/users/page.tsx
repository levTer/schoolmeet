import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { UsersTable } from "@/components/admin/users-table";
import { FormAlert } from "@/components/ui/form-alert";
import { listUsersForAdmin, type ListUsersResult } from "@/lib/admin-users";
import { authOptions, canAccessAdminArea } from "@/lib/auth";
import { getRealtimeControl } from "@/lib/realtime-control";

export const metadata: Metadata = {
  title: "Пользователи",
  description: "Управление пользователями Лицея Сингулярити: роли, классы, пароли и блокировки.",
};

export const dynamic = "force-dynamic";

/**
 * `/admin/users` — таблица пользователей с поиском и фильтрами.
 *
 * Первая страница рендерится на сервере (быстро и без «мигания»), дальше
 * таблица сама ходит в `/api/admin/users`. Онлайн-статус берём из живого
 * Socket.IO-реестра, если он есть в процессе.
 */
export default async function AdminUsersPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/admin/users");
  if (!canAccessAdminArea(session.user.role)) redirect("/dashboard?denied=admin");

  let initial: ListUsersResult | null = null;
  try {
    initial = await listUsersForAdmin({ page: 1 });

    const control = getRealtimeControl();
    if (control) {
      const online = new Set(
        control.listLiveRooms().flatMap((room) => room.participants.map((participant) => participant.userId)),
      );
      initial = {
        ...initial,
        items: initial.items.map((item) => ({ ...item, isOnline: item.isOnline || online.has(item.id) })),
      };
    }
  } catch (error) {
    console.error("[admin/users] Не удалось загрузить пользователей:", error);
  }

  if (!initial) {
    return (
      <FormAlert variant="error">
        Не удалось загрузить список пользователей. Проверьте подключение к базе данных
        (<span className="font-mono text-xs">DATABASE_URL</span>).
      </FormAlert>
    );
  }

  return <UsersTable initial={initial} actor={{ id: session.user.id, role: session.user.role }} />;
}
