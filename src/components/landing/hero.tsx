import Link from "next/link";
import { ArrowRight, KeyRound, Lock, PlayCircle, ShieldCheck, Sparkles } from "lucide-react";

import { ProductPreview } from "./product-preview";
import { InstallBlock } from "./install-block";

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
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 bg-[linear-gradient(180deg,#0A1B3D_0%,#08142E_34%,#050B1C_68%,#000000_100%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {/* Золотое свечение по центру — иконки и кнопки «горят» на глубоком синем */}
        <div className="absolute left-1/2 top-[6%] h-[30rem] w-[52rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(245,158,11,0.18),rgba(245,158,11,0.05),transparent)] blur-[70px]" />
        <div className="absolute inset-0 bg-grid mask-radial opacity-60" />
        <div className="absolute left-1/2 top-[-25%] h-[42rem] w-[42rem] -translate-x-1/2 animate-spin-slow rounded-full bg-brand-600/20 blur-[130px]" />
        <div className="absolute right-[3%] top-[12%] h-[24rem] w-[24rem] animate-float rounded-full bg-amber-500/12 blur-[110px]" />
        <div className="absolute -left-[8%] top-[38%] h-[22rem] w-[22rem] rounded-full bg-brand-500/15 blur-[120px]" />
        {/* Плавный переход в секцию ниже — в глубокий фон темы, без видимого шва */}
        <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,transparent_0%,rgb(var(--bg-deep-rgb))_100%)]" />
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
            EduFlow — Образование будущего
            <br className="hidden sm:block" />{" "}
            <span className="bg-[linear-gradient(100deg,#FDE68A_0%,#F59E0B_45%,#FCD34D_100%)] bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(245,158,11,0.25)]">
              с ИИ
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl animate-fade-up text-pretty text-base leading-relaxed text-slate-300/90 [animation-delay:140ms] sm:text-lg">
            Интерактивный холст, умные ИИ-ассистенты и видеосвязь в одном приложении. Учитесь
            вместе, идите дальше.
          </p>

          {/* Блок «Установить EduFlow» — сразу под подзаголовком, дизайн №9
              (тёмно-сланцевый фон, squircle, белая окантовка, золотые иконки) */}
          <InstallBlock />

          {/* Кнопки */}
          <div className="mt-8 flex animate-fade-up flex-col items-center justify-center gap-3 [animation-delay:440ms] sm:flex-row">
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
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition hover:border-amber-300/40 hover:bg-white/10 sm:w-auto"
            >
              <PlayCircle className="h-4 w-4 text-amber-300" />
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
