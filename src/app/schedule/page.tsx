import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft, CalendarDays, Clock3, Construction, Sparkles } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { authOptions } from "@/lib/auth";
import { DAY_LABELS, ROLE_LABELS, hasPermission, type DayOfWeek } from "@/types";

export const metadata: Metadata = {
  title: "Расписание",
  description: "Школьное расписание SchoolMeet: недельная сетка уроков по классам и учителям.",
};

export const dynamic = "force-dynamic";

const WEEK_DAYS: DayOfWeek[] = [1, 2, 3, 4, 5, 6];

/**
 * Каркас раздела «Расписание».
 * CRUD слотов и привязка комнат к занятиям появятся на этапе 3 — здесь уже
 * работает защита маршрута и разделение прав по ролям.
 */
export default async function SchedulePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login?callbackUrl=/schedule");
  }

  const { role } = session.user;
  const canEdit = hasPermission(role, "schedule:write");

  return (
    <AppShell>
      <header className="animate-fade-up">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-xs text-slate-400 transition hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          В кабинет
        </Link>

        <h1 className="mt-4 flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          <CalendarDays className="h-7 w-7 text-brand-300" />
          Расписание
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          {canEdit
            ? "Вы вошли как учитель: сможете создавать слоты, назначать предметы и привязывать комнату урока."
            : "Вы вошли как ученик: здесь появится ваше расписание и кнопки входа в урок."}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-slate-300">
          Роль: {ROLE_LABELS[role]}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-slate-300">
          {canEdit ? "Права: планирование расписания" : "Права: только просмотр"}
        </span>
      </div>

      {/* Сетка дней */}
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {WEEK_DAYS.map((day, index) => (
          <section
            key={day}
            style={{ animationDelay: `${80 + index * 60}ms` }}
            className="ring-gradient animate-fade-up rounded-3xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur-xl"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              {DAY_LABELS[day]}
            </h2>

            <div className="mt-4 space-y-2.5">
              {[0, 1, 2].map((slot) => (
                <div
                  key={slot}
                  className="flex items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-ink-900/40 px-3.5 py-3 text-xs text-slate-500"
                >
                  <Clock3 className="h-3.5 w-3.5" />
                  — —
                  <span className="ml-auto text-[11px] uppercase tracking-wider">свободно</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-8 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl sm:flex-row sm:items-center">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
          <Construction className="h-5 w-5 text-white" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-white">Слоты появятся на этапе 3</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">
            API для расписания, поиск свободных окон и привязка комнат к урокам — следующий шаг.
            Модели <span className="font-mono text-xs">Schedule</span> и{" "}
            <span className="font-mono text-xs">Meeting</span> уже описаны в Prisma-схеме.
          </p>
        </div>
        <Sparkles className="hidden h-5 w-5 shrink-0 text-brand-300 sm:ml-auto sm:block" />
      </section>
    </AppShell>
  );
}
