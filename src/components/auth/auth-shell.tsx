import Link from "next/link";
import { ShieldCheck, type LucideIcon } from "lucide-react";

import { Logo } from "@/components/landing/logo";

export interface AuthHighlight {
  icon: LucideIcon;
  title: string;
  text: string;
}

interface AuthShellProps {
  /** Надпись над заголовком в правой колонке (например, «Вход в аккаунт»). */
  eyebrow: string;
  title: string;
  subtitle: string;
  highlights: readonly AuthHighlight[];
  children: React.ReactNode;
  /** Ссылка под карточкой: «Ещё нет аккаунта? Зарегистрироваться». */
  footer?: React.ReactNode;
}

/**
 * Общий каркас страниц авторизации: тёмный фон с размытыми градиентными
 * пятнами, «стеклянная» карточка справа и презентационная панель слева.
 * Используется на `/login`, `/auth/register` и при назначении ADMIN по ссылке.
 */
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  highlights,
  children,
  footer,
}: AuthShellProps) {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-5 py-10 sm:px-8 lg:py-16">
      {/* Декоративный фон: сетка + размытые градиентные пятна */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-radial opacity-60" />
        <div className="absolute -left-24 top-1/4 h-[26rem] w-[26rem] animate-float rounded-full bg-brand-600/25 blur-[130px]" />
        <div className="absolute -right-20 top-10 h-[22rem] w-[22rem] animate-float rounded-full bg-accent-500/20 blur-[130px] [animation-delay:1.5s]" />
        <div className="absolute bottom-[-6rem] left-1/3 h-[24rem] w-[24rem] animate-float rounded-full bg-brand-600/20 blur-[140px] [animation-delay:3s]" />
      </div>

      <div className="relative grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_minmax(0,27rem)] lg:gap-16">
        {/* Презентационная колонка (только на широких экранах) */}
        <section className="hidden animate-fade-up lg:block">
          <Logo size="lg" />

          <h1 className="mt-8 text-4xl font-semibold leading-tight tracking-tight text-white xl:text-5xl">
            Уроки, доска и расписание —{" "}
            <span className="text-gradient">в одном виртуальном классе</span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-400">
            SchoolMeet — единая платформа видеоуроков: HD-трансляция, ИИ-доска с
            распознаванием формул, расписание по ролям и защищённый чат на AES-256.
          </p>

          <ul className="mt-9 grid gap-3 sm:grid-cols-2">
            {highlights.map(({ icon: Icon, title: itemTitle, text }, index) => (
              <li
                key={itemTitle}
                className="ring-gradient animate-fade-up rounded-2xl border border-white/10 bg-white/[0.035] p-4 backdrop-blur-xl transition hover:bg-white/[0.06]"
                style={{ animationDelay: `${120 + index * 90}ms` }}
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
                  <Icon className="h-4 w-4 text-white" />
                </span>
                <p className="mt-3 text-sm font-medium text-white">{itemTitle}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{text}</p>
              </li>
            ))}
          </ul>

          <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-slate-400 backdrop-blur-xl">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-300" />
            Пароли хранятся только в виде bcrypt-хешей
          </p>
        </section>

        {/* Колонка с формой */}
        <section className="w-full">
          <div className="mb-6 flex items-center justify-between lg:hidden">
            <Logo />
            <Link
              href="/"
              className="text-xs text-slate-400 underline-offset-4 transition hover:text-white hover:underline"
            >
              На главную
            </Link>
          </div>

          <div className="ring-gradient glass-card animate-fade-up p-6 shadow-glow sm:p-9">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">
              {eyebrow}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{subtitle}</p>

            <div className="mt-7">{children}</div>
          </div>

          {footer && <div className="mt-6 text-center text-sm text-slate-400">{footer}</div>}
        </section>
      </div>
    </main>
  );
}
