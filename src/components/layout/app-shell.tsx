import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { redirect } from "next/navigation";

import { Navbar } from "@/components/layout/Navbar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { authOptions } from "@/lib/auth";
import { withDeadline } from "@/lib/dashboard-fallback";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Каркас внутренних страниц платформы: навбар с профилем + контент в
 * ограниченном контейнере. Используется в /dashboard, /admin, /schedule, /meeting.
 *
 * Сессию читаем здесь один раз и передаём в навбар — так имя, роль и кнопка
 * «Выйти» попадают сразу в серверную разметку.
 */
export async function AppShell({ children, className }: AppShellProps) {
  /* Реальный тип сессии: `Awaited<ReturnType<typeof getServerSession>>`
     в next-auth 4.24 схлопывается в `unknown` и ломает сборку. */
  let session: Session | null = null;
  try {
    session = await withDeadline(getServerSession(authOptions), "app shell session");
  } catch (err) {
    console.error('[APP_SHELL_SESSION_ERROR]', err);
    session = null;
  }

  // Защита от неожиданной формы сессии: берём `user`, только если он реально есть.
  const user = session && 'user' in session ? session.user : null;

  // Заблокированный аккаунт не должен видеть внутренние разделы даже с живой
  // JWT-cookie: middleware проверяет токен, а здесь данные сессии уже сверены с БД.
  if (user?.banned) {
    redirect("/banned");
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-radial opacity-40" />
        <div className="absolute left-1/2 top-0 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-brand-600/15 blur-[140px]" />
      </div>

      <Navbar user={user ?? null} />

      <main
        className={cn(
          "mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-24 sm:px-8 sm:py-9 sm:pb-24 md:pb-9",
          className,
        )}
      >
        {children}
      </main>

      <footer className="hidden border-t border-white/5 px-5 py-6 text-center text-xs text-slate-500 sm:px-8 md:block">
        {user?.schoolName || "SchoolMeet"} · платформа видеоуроков, ИИ-доски и расписания
      </footer>

      {/* Нижняя навигация для мобильных устройств */}
      <BottomNav role={user?.role ?? null} />
    </div>
  );
}
