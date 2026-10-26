import Link from "next/link";
import { ArrowRight, KeyRound, Lock, PlayCircle, ShieldCheck, Sparkles } from "lucide-react";

import { ProductPreview } from "./product-preview";

const SECURITY_BADGES = [
  { icon: ShieldCheck, label: "AES-256", hint: "шифрование чата и материалов" },
  { icon: Lock, label: "Вход по сессии", hint: "звонок и чат только для участников" },
  { icon: KeyRound, label: "WebRTC / SRTP", hint: "защищённый медиапоток" },
] as const;

const STATS = [
  { value: "12 000+", label: "уроков проведено" },
  { value: "40 мс", label: "задержка видео" },
  { value: "99,9%", label: "доступность" },
] as const;

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-28 pt-32 sm:pt-40">
      {/* Фоновые слои */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-radial opacity-60" />
        <div className="absolute left-1/2 top-[-25%] h-[42rem] w-[42rem] -translate-x-1/2 animate-spin-slow rounded-full bg-brand-600/20 blur-[130px]" />
        <div className="absolute right-[3%] top-[12%] h-[24rem] w-[24rem] animate-float rounded-full bg-accent-500/15 blur-[110px]" />
        <div className="absolute -left-[8%] top-[38%] h-[22rem] w-[22rem] rounded-full bg-brand-500/15 blur-[120px]" />
      </div>

      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mx-auto max-w-4xl text-center">
          {/* Бейдж */}
          <div className="inline-flex animate-fade-up items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs text-slate-300 backdrop-blur">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-gradient px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              <Sparkles className="h-3 w-3" />
              New
            </span>
            EduFlow · ИИ-ассистент встроен прямо в урок
          </div>

          {/* Заголовок */}
          <h1 className="mt-7 animate-fade-up text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-white [animation-delay:80ms] sm:text-6xl lg:text-7xl">
            Zoom нового поколения для школ
            <br className="hidden sm:block" />{" "}
            <span className="text-gradient-brand">с ИИ-ассистентом</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl animate-fade-up text-base leading-relaxed text-slate-400 [animation-delay:140ms] sm:text-lg">
            HD-видеозвонки, интерактивная доска с распознаванием формул, школьное расписание с
            разграничением ролей и защищённый чат — в одной платформе, которую учитель запускает за
            один клик.
          </p>

          {/* Кнопки */}
          <div className="mt-9 flex animate-fade-up flex-col items-center justify-center gap-3 [animation-delay:200ms] sm:flex-row">
            <Link
              href="/auth/register"
              className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-brand-gradient px-7 py-3.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.02] sm:w-auto"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <span className="relative">Начать урок</span>
              <ArrowRight className="relative h-4 w-4 transition group-hover:translate-x-1" />
            </Link>

            <a
              href="#features"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10 sm:w-auto"
            >
              <PlayCircle className="h-4 w-4" />
              Демонстрация
            </a>
          </div>

          {/* Бейджи безопасности */}
          <div className="mt-10 flex animate-fade-up flex-wrap items-center justify-center gap-3 [animation-delay:260ms]">
            {SECURITY_BADGES.map((badge) => (
              <div
                key={badge.label}
                className="glass flex items-center gap-3 rounded-2xl px-4 py-2.5 text-left"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-300/20 to-brand-500/5 text-brand-300 ring-1 ring-brand-400/20">
                  <badge.icon className="h-4 w-4" />
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-semibold text-white">{badge.label}</span>
                  <span className="block text-[11px] text-slate-400">{badge.hint}</span>
                </span>
              </div>
            ))}
          </div>

          {/* Статистика */}
          <dl className="mx-auto mt-12 grid max-w-2xl animate-fade-up grid-cols-3 gap-4 [animation-delay:320ms]">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="block text-2xl font-semibold text-white sm:text-3xl">
                    {stat.value}
                  </span>
                  <span className="mt-1 block text-[11px] uppercase tracking-wider text-slate-500 sm:text-xs">
                    {stat.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <ProductPreview />
      </div>
    </section>
  );
}
