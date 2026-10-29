import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";

import { AdminNav } from "@/components/admin/admin-nav";
import { AppShell } from "@/components/layout/app-shell";
import { authOptions } from "@/lib/auth";
import { withDeadline } from "@/lib/dashboard-fallback";
import { getLiveAdminViewer } from "@/lib/session-viewer";

export const metadata: Metadata = {
  title: "Админ-панель",
  description: "Управление лицеем Сингулярити: пользователи, уроки, объявления и статистика.",
};

export const dynamic = "force-dynamic";

/**
 * Каркас админ-панели — строго для суперадмина (ADMIN).
 *
 * Доступ проверяется дважды: в middleware (до рендера) и здесь — прямо перед
 * выдачей данных. Учитель или ученик, попавший сюда в обход middleware,
 * уходит в кабинет с пометкой `denied=admin` (её показывает toast
 * «Доступ открыт только Администратору школы»).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  /* `Awaited<ReturnType<typeof getServerSession>>` в next-auth 4.24 схлопывается
     в `unknown` (generic `R` выводится только из аргументов вызова), поэтому
     аннотация врала и `next build` падал с TS2339. Объявляем реальный тип. */
  let session: Session | null = null;
  try {
    session = await withDeadline(getServerSession(authOptions), "admin layout session");
  } catch (err) {
    console.error('[ADMIN_LAYOUT_SESSION_ERROR]', err);
    session = null;
  }

  /* Защита от неожиданной формы сессии: берём `user`, только если он реально
     есть в объекте сессии. */
  const user = session && 'user' in session ? session.user : null;
  if (!user) {
    redirect("/login?callbackUrl=/admin");
  }

  /**
   * Вторая, «живая» проверка роли по БД (исправление H-01): раздел открывается,
   * только если администратор подтверждён базой прямо сейчас. Устаревший или
   * подделанный claim в JWT здесь уже не проходит, а при недоступной БД доступ
   * закрыт (fail-closed).
   */
  const admin = await getLiveAdminViewer();
  if (!admin) {
    redirect("/dashboard?denied=admin");
  }

  return (
    <AppShell>
      <header className="animate-fade-up flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">Управление школой</p>
          <h1 className="mt-2 text-lg font-semibold tracking-tight sm:text-xl">Админ-панель</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Пользователи и роли, активные уроки, посещаемость и общешкольные объявления.
            Раздел открыт только Администратору школы.
          </p>
        </div>
      </header>

      <div className="mt-6">
        <AdminNav />
      </div>

      <div className="mt-6">{children}</div>
    </AppShell>
  );
}
