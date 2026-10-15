import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft, CalendarDays } from "lucide-react";

import { ScheduleBoard } from "@/components/schedule/schedule-board";
import { AppShell } from "@/components/layout/app-shell";
import { authOptions } from "@/lib/auth";
import { listLessonsForViewer, listSubjects } from "@/lib/schedule";
import { getSchoolViewer } from "@/lib/school-viewer";
import { listClassesForSchool } from "@/lib/schools";
import { ROLE_LABELS, hasPermission } from "@/types";

export const metadata: Metadata = {
  title: "Расписание",
  description: "Расписание Лицея Сингулярити: недельная сетка уроков класса и вход в урок.",
};

export const dynamic = "force-dynamic";

/**
 * Расписание. Ученик видит уроки своего класса, учитель — свои, администратор — всё.
 * Данные грузим на сервере по роли; таймер, статусы и красная линия считаются в браузере.
 */
export default async function SchedulePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login?callbackUrl=/schedule");
  }

  const viewer = await getSchoolViewer(session.user.id);
  if (!viewer) {
    redirect("/login?callbackUrl=/schedule");
  }

  const canEdit = hasPermission(viewer.role, "schedule:write");
  const [lessons, subjects, classes] = await Promise.all([
    listLessonsForViewer(viewer),
    canEdit ? listSubjects() : Promise.resolve([]),
    canEdit && viewer.schoolId ? listClassesForSchool(viewer.schoolId) : Promise.resolve([]),
  ]);

  const description = canEdit
    ? "Планируйте уроки по классам: предмет, время и кабинет. Каждый урок получает комнату для входа."
    : viewer.role === "STUDENT"
      ? viewer.className
        ? `Расписание класса ${viewer.className} на неделю. Кнопка «Войти» откроет текущий или ближайший урок.`
        : "Класс не назначен — расписание появится после назначения класса."
      : "Расписание школы.";

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

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <CalendarDays className="h-7 w-7 text-brand-300" />
              Расписание
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{description}</p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300">
            {ROLE_LABELS[viewer.role]}
          </span>
        </div>
      </header>

      <div className="mt-8">
        <ScheduleBoard
          lessons={lessons}
          subjects={subjects}
          classes={classes}
          viewer={{ id: viewer.id, role: viewer.role, grade: viewer.grade, classId: viewer.classId }}
        />
      </div>
    </AppShell>
  );
}
