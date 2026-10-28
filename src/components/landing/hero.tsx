import Link from "next/link";
import { ArrowRight, KeyRound, Lock, PlayCircle, ShieldCheck } from "lucide-react";

import { ProductPreview } from "./product-preview";
import { InstallBlock } from "./install-block";

const SECURITY_BADGES = [
  { icon: ShieldCheck, label: "AES-256", hint: "шифрование чата" },
  { icon: Lock, label: "Вход по сессии", hint: "только участники" },
  { icon: KeyRound, label: "WebRTC / SRTP", hint: "защищённый медиапоток" },
] as const;

const STATS = [
  { value: "12 000+", label: "уроков проведено" },
  { value: "40 мс", label: "задержка видео" },
  { value: "99,9%", label: "доступность" },
] as const;

/**
 * Hero-секция лендинга в дизайн-системе «Telegram × Twitch Dark».
 *
 * Плоский графитовый фон #0B0F17, один сдержанный акцент темы, заголовок
 * `text-3xl/4xl font-semibold` (не гигантский), карточки `rounded-2xl` с
 * окантовкой `border-white/10`. Блок установки — сразу под подзаголовком.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden pb-20 pt-24 sm:pb-24 sm:pt-28">
      {/* Фон: ровный графит + очень тихое свечение акцента */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-radial opacity-40" />
        <div className="absolute left-1/2 top-[-14rem] h-[26rem] w-[42rem] -translate-x-1/2 rounded-full bg-brand-500/[0.07] blur-[120px]" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          {/* Бейдж */}
          <div className="inline-flex animate-fade-up items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-300">
              New
            </span>
            ИИ-ассистент встроен прямо в урок
          </div>

          <h1 className="mt-5 animate-fade-up text-balance text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
            EduFlow — Образование будущего{" "}
            <span className="text-brand-400">с ИИ</span>
          </h1>

          <p className="mx-auto mt-3 max-w-xl animate-fade-up text-pretty text-sm leading-relaxed text-slate-400 sm:text-base">
            Интерактивный холст, умные ИИ-ассистенты и видеосвязь в одном приложении. Учитесь
            вместе, идите дальше.
          </p>

          {/* Установка: APK / PWA / Windows / Mac — сразу под подзаголовком */}
          <InstallBlock />

          {/* Кнопки */}
          <div className="mt-7 flex animate-fade-up flex-col items-center justify-center gap-2 sm:flex-row">
            <Link
              href="/auth/register"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-5 text-sm font-medium text-canvas transition hover:bg-brand-400 sm:w-auto"
            >
              Начать урок
              <ArrowRight className="h-4 w-4" />
            </Link>

            <a
              href="#features"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-5 text-sm font-medium text-white transition hover:bg-white/[0.06] sm:w-auto"
            >
              <PlayCircle className="h-4 w-4 text-brand-300" />
              Демонстрация
            </a>
          </div>

          {/* Бейджи безопасности */}
          <div className="mt-8 flex animate-fade-up flex-wrap items-center justify-center gap-2">
            {SECURITY_BADGES.map((badge) => (
              <div
                key={badge.label}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-left"
              >
                <badge.icon className="h-3.5 w-3.5 text-brand-300" />
                <span className="leading-tight">
                  <span className="block text-xs font-medium text-white">{badge.label}</span>
                  <span className="block text-[10px] text-slate-500">{badge.hint}</span>
                </span>
              </div>
            ))}
          </div>

          {/* Статистика */}
          <dl className="mx-auto mt-8 grid max-w-lg animate-fade-up grid-cols-3 gap-3">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="block text-lg font-semibold text-white">{stat.value}</span>
                  <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-slate-500">
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
