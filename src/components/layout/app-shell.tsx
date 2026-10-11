import { getServerSession } from "next-auth";

import { Navbar } from "@/components/layout/Navbar";
import { authOptions } from "@/lib/auth";
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
  const session = await getServerSession(authOptions);

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-radial opacity-40" />
        <div className="absolute left-1/2 top-0 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-brand-600/15 blur-[140px]" />
      </div>

      <Navbar user={session?.user ?? null} />

      <main className={cn("mx-auto w-full max-w-7xl flex-1 px-5 py-9 sm:px-8", className)}>
        {children}
      </main>

      <footer className="border-t border-white/5 px-5 py-6 text-center text-xs text-slate-500 sm:px-8">
        SchoolMeet · Этап 3 — видеозвонки, чат и realtime
      </footer>
    </div>
  );
}
