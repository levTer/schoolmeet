import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";

import { Logo } from "@/components/landing/logo";

export const metadata: Metadata = {
  title: "Вход",
  description: "Вход в SchoolMeet — авторизация по ролям: администратор, учитель, ученик.",
};

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 py-16">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-radial opacity-50" />
        <div className="absolute left-1/2 top-1/4 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-brand-600/20 blur-[120px]" />
      </div>

      <Logo className="mb-8" size="lg" />

      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-xl">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gradient">
          <Construction className="h-5 w-5 text-white" />
        </span>

        <h1 className="mt-5 text-2xl font-semibold">Вход в SchoolMeet</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Форма авторизации (NextAuth + Prisma) появится на этапе 2. Уже готовы роли:{" "}
          <span className="text-slate-200">ADMIN</span>, <span className="text-slate-200">TEACHER</span>{" "}
          и <span className="text-slate-200">STUDENT</span>.
        </p>

        <Link
          href="/"
          className="mt-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>
      </div>
    </main>
  );
}
