"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarDays, Home } from "lucide-react";

/**
 * Error Boundary уровня сегмента `/dashboard`.
 *
 * Страховка последнего рубежа: если RSC-рендер кабинета всё-таки упал (например,
 * база Neon не ответила и запрос завершился фатально), посетитель видит
 * аккуратную glass-morphism страницу с кнопкой «🔄 Обновить страницу», а не
 * стандартный белый экран ошибки Next.js. Кнопка вызывает `reset()` — Next.js
 * повторяет рендер сегмента, не перезагружая всю страницу.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[DASHBOARD_ERROR_BOUNDARY]", error);
  }, [error]);

  return (
    <main className="relative flex min-h-[70vh] items-center justify-center overflow-hidden px-4 py-12 sm:px-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/3 top-1/4 h-[26rem] w-[26rem] rounded-full bg-rose-500/15 blur-[150px]" />
        <div className="absolute bottom-1/4 right-1/4 h-[20rem] w-[20rem] rounded-full bg-brand-600/20 blur-[140px]" />
        <div className="absolute inset-0 bg-grid mask-radial opacity-30" />
      </div>

      <div className="glass-strong ring-gradient animate-fade-up w-full max-w-lg rounded-3xl p-6 text-center shadow-glow sm:p-10">
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-500/15">
          <AlertTriangle className="h-6 w-6 text-amber-300" />
        </span>

        <h1 className="mt-5 text-xl font-semibold text-white sm:text-2xl">
          Кабинет не догрузился
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
          Похоже, база данных ответила не вовремя. Данные в безопасности: уроки, задания и оценки
          остались на месте — попробуйте обновить дашборд.
        </p>

        {error.digest && (
          <p className="mt-3 font-mono text-xs text-slate-500">Код ошибки: {error.digest}</p>
        )}

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-brand-contrast shadow-glow transition hover:scale-[1.03]"
          >
            {/* `reset()` перезапускает рендер сегмента без перезагрузки страницы. */}
            🔄 Обновить страницу
          </button>
          <Link
            href="/schedule"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10"
          >
            <CalendarDays className="h-4 w-4" />
            Открыть расписание
          </Link>
        </div>

        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-brand-300 transition hover:text-brand-200"
          >
            <Home className="h-3 w-3" />
            На главную
          </Link>
        </div>
      </div>
    </main>
  );
}
