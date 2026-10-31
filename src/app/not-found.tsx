import Link from "next/link";
import { ArrowLeft, Compass, Home } from "lucide-react";

/**
 * Страница 404 — glass-morphism стиль в духе Лицея Сингулярити.
 */
export default function NotFound() {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-5 py-16">
      {/* Фоновые размытые пятна */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-1/4 h-[32rem] w-[32rem] rounded-full bg-brand-600/20 blur-[160px]" />
        <div className="absolute right-1/4 bottom-1/4 h-[24rem] w-[24rem] rounded-full bg-accent-500/15 blur-[140px]" />
        <div className="absolute inset-0 bg-grid mask-radial opacity-30" />
      </div>

      <div className="glass-strong ring-gradient animate-fade-up w-full max-w-lg rounded-3xl p-8 text-center shadow-glow sm:p-12">
        {/* Большая цифра 404 */}
        <div className="relative">
          <p className="text-gradient text-[7rem] font-black leading-none tracking-tighter sm:text-[9rem]">
            404
          </p>
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <Compass className="h-12 w-12 text-brand-300/50 sm:h-16 sm:w-16" />
          </span>
        </div>

        <h1 className="mt-4 text-2xl font-semibold text-white sm:text-3xl">
          Страница не найдена
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
          Возможно, она была удалена, переименована или её никогда не существовало.
          Проверьте адрес или вернитесь на главную.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-brand-contrast shadow-glow transition hover:scale-[1.03]"
          >
            <Home className="h-4 w-4" />
            На главную
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            В кабинет
          </Link>
        </div>
      </div>
    </main>
  );
}
