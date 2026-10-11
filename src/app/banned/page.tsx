import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Mail, ShieldOff } from "lucide-react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/landing/logo";
import { authOptions } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Аккаунт заблокирован",
  description: "Доступ к SchoolMeet ограничен администратором школы.",
};

export const dynamic = "force-dynamic";

/**
 * Экран блокировки: сюда middleware и `AppShell` отправляют пользователей,
 * чей аккаунт заблокирован администратором (модель `User.isBanned`).
 */
export default async function BannedPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login?callbackUrl=/banned");
  }
  if (!session.user.banned) {
    redirect("/dashboard");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-5 py-16">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-radial opacity-40" />
        <div className="absolute left-1/2 top-0 h-[22rem] w-[22rem] -translate-x-1/2 rounded-full bg-rose-500/10 blur-[140px]" />
      </div>

      <div className="glass-strong animate-fade-up w-full max-w-lg rounded-3xl p-8 text-center">
        <Logo size="sm" className="mx-auto" />

        <span className="mx-auto mt-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/15">
          <ShieldOff className="h-6 w-6 text-rose-300" />
        </span>

        <h1 className="mt-5 text-2xl font-semibold text-white">Аккаунт заблокирован</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Доступ к платформе ограничен администратором школы. Сессия на видеозвонках разорвана, вход в
          кабинет, расписание и уроки закрыт.
        </p>

        <p className="mt-4 text-sm text-slate-400">
          Аккаунт: <span className="font-medium text-slate-200">{session.user.email}</span>
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <SignOutButton />
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10"
          >
            На главную
          </Link>
        </div>

        <p className="mt-6 inline-flex items-center gap-2 text-xs text-slate-500">
          <Mail className="h-3.5 w-3.5" />
          Считаете блокировку ошибкой — напишите администрации школы.
        </p>
      </div>
    </main>
  );
}
