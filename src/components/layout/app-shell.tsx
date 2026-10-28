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
  /**
   * `flush` — полноэкранный режим без внешнего контейнера и футера: шапка,
   * контент на всю высоту и нижняя навигация. Используется однoэкранным
   * кабинетом (`h-[100dvh] flex flex-col`, Zero-Scroll на мобильных).
   */
  flush?: boolean;
}

/**
 * Каркас внутренних страниц платформы: навбар с профилем + контент.
 *
 * Дизайн-система Telegram/Twitch Dark: плоский фон `--bg-primary`, карточки
 * `#111827` с окантовкой `border-white/10`, нижняя навигация с safe-area.
 * На мобильных работает Zero-Scroll: прокручивается только `.app-frame`.
 */
export async function AppShell({ children, className, flush = false }: AppShellProps) {
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
  const schoolName = session?.user?.schoolName || "EduFlow";

  // Заблокированный аккаунт не должен видеть внутренние разделы даже с живой
  // JWT-cookie: middleware проверяет токен, а здесь данные сессии уже сверены с БД.
  if (user?.banned) {
    redirect("/banned");
  }

  return (
    <div
      className={cn(
        "relative flex min-h-[100dvh] flex-col",
        /* Однoэкранный кабинет: ровно 100dvh, прокрутка — только внутри контента. */
        flush && "h-[100dvh] overflow-hidden md:h-auto md:min-h-[100dvh] md:overflow-visible",
      )}
    >
      <Navbar user={user ?? null} />

      <main
        className={cn(
          flush
            ? "flex min-h-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0"
            : "mx-auto w-full max-w-7xl flex-1 px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pt-4 md:pb-6",
          className,
        )}
      >
        {children}
      </main>

      {!flush ? (
        <footer className="hidden border-t border-white/10 px-5 py-4 text-center text-xs text-slate-500 sm:px-8 md:block">
          {schoolName} · платформа видеоуроков, ИИ-доски и расписания
        </footer>
      ) : null}

      {/* Нижняя навигация для мобильных устройств */}
      <BottomNav role={user?.role ?? null} />
    </div>
  );
}
