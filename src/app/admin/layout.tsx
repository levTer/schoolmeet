import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { AdminNav } from "@/components/admin/admin-nav";
import { AppShell } from "@/components/layout/app-shell";
import { authOptions, canAccessAdminArea } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Админ-панель",
  description: "Управление школой SchoolMeet: пользователи, уроки, объявления и статистика.",
};

export const dynamic = "force-dynamic";

/**
 * Каркас админ-панели.
 *
 * Доступ проверяется дважды: в middleware (до рендера) и здесь — прямо перед
 * выдачей данных. Если ученик попадёт сюда в обход middleware, он уйдёт в
 * кабинет с пометкой `denied`.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login?callbackUrl=/admin");
  }
  if (!canAccessAdminArea(session.user.role)) {
    redirect("/dashboard?denied=/admin");
  }
  if (session.user.banned) {
    redirect("/banned");
  }

  return (
    <AppShell>
      <header className="animate-fade-up flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">Управление школой</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Админ-панель</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Пользователи и роли, активные уроки, посещаемость и общешкольные объявления.
            {session.user.role === "TEACHER" && " Учителю доступен просмотр и модерация учеников."}
          </p>
        </div>
      </header>

      <div className="mt-6">
        <AdminNav role={session.user.role} />
      </div>

      <div className="mt-6">{children}</div>
    </AppShell>
  );
}
