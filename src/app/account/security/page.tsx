import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { SecurityPanel } from "@/components/account/security-panel";
import { AppShell } from "@/components/layout/app-shell";
import { authOptions } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Безопасность аккаунта",
  description: "Двухфакторная защита и резервные коды аккаунта EduFlow.",
};

export const dynamic = "force-dynamic";

/**
 * Страница безопасности собственного аккаунта.
 *
 * Доступна любому вошедшему пользователю: 2FA полезна и ученику (личная
 * переписка), и учителю (доступ к урокам и оценкам). Сессию проверяем здесь
 * и в `proxy.ts` — скрытая ссылка защитой не является.
 */
export default async function AccountSecurityPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Faccount%2Fsecurity");

  return (
    <AppShell>
      <header className="mb-6 space-y-2 animate-fade-up">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          В кабинет
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
          <ShieldCheck className="h-6 w-6 text-brand-300" />
          Безопасность аккаунта
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
          Второй фактор защищает вход, даже если пароль украдут: без кода из телефона войти
          не получится. Резервные коды заменяют телефон, если он потеряется.
        </p>
      </header>

      <div className="max-w-2xl">
        <SecurityPanel />
      </div>
    </AppShell>
  );
}
