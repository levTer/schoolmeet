"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Home, RefreshCcw } from "lucide-react";

/**
 * Error Boundary уровня route-сегмента (Next.js App Router).
 * Показывает красивую glass-morphism страницу при необработанной ошибке.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-5 py-16">
      {/* Фоновые размытые пятна */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/3 top-1/4 h-[30rem] w-[30rem] rounded-full bg-rose-500/15 blur-[160px]" />
        <div className="absolute right-1/4 bottom-1/3 h-[22rem] w-[22rem] rounded-full bg-brand-600/20 blur-[140px]" />
        <div className="absolute inset-0 bg-grid mask-radial opacity-30" />
      </div>

      <div className="glass-strong ring-gradient animate-fade-up w-full max-w-lg rounded-3xl p-8 text-center shadow-glow sm:p-12">
        <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/15">
          <AlertTriangle className="h-7 w-7 text-rose-300" />
        </span>

        <h1 className="mt-5 text-2xl font-semibold text-white sm:text-3xl">
          Что-то пошло не так
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
          Произошла непредвиденная ошибка. Мы уже работаем над её исправлением.
          Попробуйте обновить страницу или вернуться позже.
        </p>

        {error.digest && (
          <p className="mt-3 font-mono text-xs text-slate-500">
            Код ошибки: {error.digest}
          </p>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-brand-contrast shadow-glow transition hover:scale-[1.03]"
          >
            <RefreshCcw className="h-4 w-4" />
            Попробовать снова
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10"
          >
            <Home className="h-4 w-4" />
            На главную
          </Link>
        </div>

        <div className="mt-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-brand-300 transition hover:text-brand-200"
          >
            <ArrowLeft className="h-3 w-3" />
            Вернуться в кабинет
          </Link>
        </div>
      </div>
    </main>
  );
}
