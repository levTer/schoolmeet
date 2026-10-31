"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, ShieldCheck } from "lucide-react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ADMIN_ERROR_BOUNDARY]", error);
  }, [error]);

  return (
    <main className="relative flex min-h-[70vh] items-center justify-center overflow-hidden px-4 py-12 sm:px-6">
      <div className="glass-strong ring-gradient animate-fade-up w-full max-w-lg rounded-3xl p-6 text-center shadow-glow sm:p-10">
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-500/15">
          <AlertTriangle className="h-6 w-6 text-amber-300" />
        </span>

        <h1 className="mt-5 text-xl font-semibold text-white sm:text-2xl">
          Админ-панель не догрузилась
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
          Похоже, база данных ответила не вовремя. Попробуйте обновить страницу.
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
            🔄 Обновить страницу
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10"
          >
            <ShieldCheck className="h-4 w-4" />
            В кабинет
          </Link>
        </div>

        <div className="mt-6">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-brand-300 transition hover:text-brand-200">
            <Home className="h-3 w-3" />
            На главную
          </Link>
        </div>
      </div>
    </main>
  );
}
