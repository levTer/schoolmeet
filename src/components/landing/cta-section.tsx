import Link from "next/link";
import { ArrowRight, PlayCircle } from "lucide-react";

export function CtaSection() {
  return (
    <section className="relative px-5 pb-24 pt-8 sm:px-8">
      <div className="card relative mx-auto max-w-5xl overflow-hidden px-5 py-10 text-center sm:px-10 sm:py-12">
        <div
          aria-hidden
          className="absolute left-1/2 top-0 -z-10 h-48 w-[36rem] -translate-x-1/2 rounded-full bg-brand-500/[0.06] blur-3xl"
        />

        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Готовы провести первый урок?
        </h2>
        <p className="mx-auto mt-2.5 max-w-xl text-sm leading-relaxed text-slate-400">
          Создайте аккаунт учителя, добавьте расписание — и комната для урока соберётся сама за
          минуту до звонка.
        </p>

        <div className="mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Link
            href="/auth/register"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-5 text-sm font-medium text-canvas transition hover:bg-brand-400 sm:w-auto"
          >
            Начать урок
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </Link>
          <a
            href="#features"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-5 text-sm font-medium text-white transition hover:bg-white/[0.06] sm:w-auto"
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
