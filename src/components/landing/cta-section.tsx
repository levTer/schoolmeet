import Link from "next/link";
import { ArrowRight, PlayCircle } from "lucide-react";

export function CtaSection() {
  return (
    <section className="relative px-5 pb-24 pt-8 sm:px-8">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900/70 px-6 py-14 text-center backdrop-blur-xl sm:px-14 sm:py-16">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[length:200%_200%] animate-gradient-pan"
          style={{
            backgroundImage:
              "linear-gradient(120deg, rgba(139,92,246,.28), rgba(99,102,241,.18), rgba(56,189,248,.24), rgba(139,92,246,.28))",
          }}
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-grid opacity-20" />

        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Готовы провести первый урок?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base text-slate-300/90">
          Создайте аккаунт учителя, добавьте расписание — и комната для урока соберётся сама за
          минуту до звонка.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/auth/register"
            className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-gradient px-7 py-3.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.02] sm:w-auto"
          >
            Начать урок
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </Link>
          <a
            href="#features"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/25 bg-white/10 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20 sm:w-auto"
          >
            <PlayCircle className="h-4 w-4" />
            Демонстрация
          </a>
        </div>

        <p className="mt-6 text-xs text-slate-400/80">
          Бесплатно для классов до 10 человек · Без привязки карты
        </p>
      </div>
    </section>
  );
}
