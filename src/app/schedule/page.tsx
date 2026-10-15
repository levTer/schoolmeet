import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession, type Session } from "next-auth";
import { ArrowLeft, CalendarDays } from "lucide-react";

import { ScheduleBoard } from "@/components/schedule/schedule-board";
import { AppShell } from "@/components/layout/app-shell";
import { FormAlert } from "@/components/ui/form-alert";
import { authOptions } from "@/lib/auth";
import { viewerFromClaims, withDeadline } from "@/lib/dashboard-fallback";
import { listLessonsForViewer, listSubjects } from "@/lib/schedule";
import { getSchoolViewer, type SchoolViewer } from "@/lib/school-viewer";
import { listClassesForSchool, type SchoolClassOption } from "@/lib/schools";
import { ROLE_LABELS, hasPermission, type Schedule, type Subject } from "@/types";

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
  /* Сессию читаем в изолированном блоке: callback `jwt` тоже ходит в БД и при
     задержке Neon может бросить исключение. Страница из-за этого падать не должна. */
  let session: Session | null = null;
  try {
    session = await withDeadline(getServerSession(authOptions), "schedule session");
  } catch (err) {
    console.error("[SCHEDULE_SESSION_WARN]", err);
  }

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/schedule");
  }

  /* Зритель из БД: при задержке Neon берём роль/школу из подписанного токена. */
  let viewer: SchoolViewer | null = null;
  let viewerNotFound = false;
  let databaseDegraded = false;
  try {
    // Обёртка сохраняет различие между «БД вернула null» и дедлайном.
    const result = await withDeadline(
      getSchoolViewer(session.user.id).then((value) => ({ value })),
      "schedule viewer",
    );
    if (result === null) databaseDegraded = true;
    else if (result.value) viewer = result.value;
    else viewerNotFound = true;
  } catch (err) {
    console.error("[SCHEDULE_VIEWER_WARN]", err);
    databaseDegraded = true;
  }

  if (viewerNotFound) {
    redirect("/login?callbackUrl=/schedule");
  }
  if (!viewer) {
    databaseDegraded = true;
    viewer = viewerFromClaims({
      id: session.user.id,
      role: session.user.role,
      schoolId: session.user.schoolId,
      classId: session.user.classId,
      isBanned: session.user.banned,
    });
  }

  const canEdit = hasPermission(viewer.role, "schedule:write");

  /* Данные расписания: при сбое/тайм-ауте БД — валидный fallback с пустыми массивами. */
  let lessons: Schedule[] = [];
  let subjects: Subject[] = [];
  let classes: SchoolClassOption[] = [];
  try {
    const result = await withDeadline(
      Promise.all([
        listLessonsForViewer(viewer),
        canEdit ? listSubjects() : Promise.resolve([] as Subject[]),
        canEdit && viewer.schoolId
          ? listClassesForSchool(viewer.schoolId)
          : Promise.resolve([] as SchoolClassOption[]),
      ]),
      "schedule page data",
    );
    if (result) [lessons, subjects, classes] = result;
    else databaseDegraded = true;
  } catch (err) {
    console.error("[SCHEDULE_DATA_WARN]", err);
    databaseDegraded = true;
  }

  const description = canEdit
    ? "Планируйте уроки по классам: предмет, время и кабинет. Каждый урок получает комнату для входа."
    : viewer.role === "STUDENT"
      ? viewer.className
        ? `Расписание класса ${viewer.className} на неделю. Кнопка «Войти» откроет текущий или ближайший урок.`
        : "Класс не назначен — расписание появится после назначения класса."
      : "Расписание школы.";

  return (
    <AppShell>
      {databaseDegraded && (
        <FormAlert variant="info" className="mb-6">
          База данных временно отвечает медленно. Расписание открыто, но часть данных не загрузилась;
          попробуйте обновить страницу позже.
        </FormAlert>
      )}
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
