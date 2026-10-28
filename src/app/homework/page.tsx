import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession, type Session } from "next-auth";
import { ArrowLeft, ClipboardList } from "lucide-react";

import { HomeworkCard } from "@/components/homework/homework-card";
import { HomeworkCreateButton } from "@/components/homework/homework-create-modal";
import { HomeworkEmptyState } from "@/components/homework/homework-empty-state";
import { AppShell } from "@/components/layout/app-shell";
import { FormAlert } from "@/components/ui/form-alert";
import { authOptions } from "@/lib/auth";
import { viewerFromClaims, withDeadline } from "@/lib/dashboard-fallback";
import { listHomeworkForViewer } from "@/lib/homework";
import { listSubjects } from "@/lib/schedule";
import { listClassesForSchool, type SchoolClassOption } from "@/lib/schools";
import { getSchoolViewer, type SchoolViewer } from "@/lib/school-viewer";
import { hasPermission, type HomeworkListItem, type Subject } from "@/types";

export const metadata: Metadata = {
  title: "Домашние задания",
  description: "Домашние задания Лицея Сингулярити: сроки сдачи, ответы и проверка учителем.",
};

export const dynamic = "force-dynamic";

/**
 * Домашние задания. Ученик: «Нужно сдать» и «Сданы». Учитель: все выданные задания
 * со статистикой сдачи и кнопкой «Новое задание».
 */
export default async function HomeworkPage() {
  let session: Session | null = null;
  try {
    session = await withDeadline(getServerSession(authOptions), "homework session");
  } catch (err) {
    console.error("[HOMEWORK_SESSION_WARN]", err);
  }
  if (!session?.user?.id) redirect("/login?callbackUrl=/homework");

  let viewer: SchoolViewer | null = null;
  let viewerNotFound = false;
  let databaseDegraded = false;
  try {
    // Обёртка сохраняет различие между «БД вернула null» и дедлайном.
    const result = await withDeadline(
      getSchoolViewer(session.user.id).then((value) => ({ value })),
      "homework viewer",
    );
    if (result === null) databaseDegraded = true;
    else if (result.value) viewer = result.value;
    else viewerNotFound = true;
  } catch (err) {
    console.error("[HOMEWORK_VIEWER_WARN]", err);
    databaseDegraded = true;
  }

  if (viewerNotFound) redirect("/login?callbackUrl=/homework");
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

  const canWrite = hasPermission(viewer.role, "homework:write");

  /* Данные ДЗ/каталогов: при ошибке или дедлайне остаётся пустой, но валидный UI. */
  let homeworks: HomeworkListItem[] = [];
  let subjects: Subject[] = [];
  let classes: SchoolClassOption[] = [];
  try {
    const result = await withDeadline(
      Promise.all([
        listHomeworkForViewer(viewer),
        canWrite ? listSubjects() : Promise.resolve([] as Subject[]),
        canWrite && viewer.schoolId
          ? listClassesForSchool(viewer.schoolId)
          : Promise.resolve([] as SchoolClassOption[]),
      ]),
      "homework page data",
    );
    if (result) [homeworks, subjects, classes] = result;
    else databaseDegraded = true;
  } catch (err) {
    console.error("[HOMEWORK_DATA_WARN]", err);
    databaseDegraded = true;
  }

  const role = viewer.role as "STUDENT" | "TEACHER" | "ADMIN";
  const todo = homeworks.filter((item) => !item.mySubmission || item.mySubmission.status === "DRAFT");
  const done = homeworks.filter((item) => item.mySubmission && item.mySubmission.status !== "DRAFT");

  // pt-24 / pt-28 — свободное пространство под фиксированной шапкой (Navbar, z-50).
  return (
    <AppShell className="pt-24 sm:pt-28">
      {databaseDegraded && (
        <FormAlert variant="info" className="mb-6">
          База данных временно отвечает медленно. Страница открыта, но задания не загрузились;
          попробуйте обновить страницу позже.
        </FormAlert>
      )}
      <header className="animate-fade-up flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-xs text-slate-400 transition hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" />
            В кабинет
          </Link>
          <h1 className="mt-4 flex items-center gap-3 text-lg font-semibold tracking-tight sm:text-xl">
            <ClipboardList className="h-7 w-7 text-brand-300" />
            Домашние задания
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            {role === "STUDENT"
              ? viewer.className
                ? `Задания для класса ${viewer.className}. Цвет индикатора показывает, сколько осталось до дедлайна.`
                : "Класс не назначен — задания появятся после назначения класса."
              : "Выданные задания, сроки и проверка работ. Черновики ИИ видите только вы."}
          </p>
        </div>
        {canWrite && <HomeworkCreateButton subjects={subjects} classes={classes} />}
      </header>

      {role === "STUDENT" ? (
        <div className="relative z-0 mt-8 space-y-10">
          <HomeworkSection title="Нужно сдать" items={todo} role={role} empty="Всё сдано — отличная работа!" />
          <HomeworkSection title="Сданы" items={done} role={role} empty="Здесь появятся работы, которые вы сдали." />
        </div>
      ) : (
        <div className="relative z-0 mt-8">
          <HomeworkSection title="Задания" items={homeworks} role={role} empty="Вы ещё не выдали ни одного задания." />
        </div>
      )}
    </AppShell>
  );
}

function HomeworkSection({
  title,
  items,
  role,
  empty,
}: {
  title: string;
  items: HomeworkListItem[];
  role: "STUDENT" | "TEACHER" | "ADMIN";
  empty: string;
}) {
  return (
    <section aria-label={title}>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
        {title} <span className="text-slate-600">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <HomeworkEmptyState text={empty} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item, index) => (
            <HomeworkCard key={item.id} item={item} viewerRole={role} index={index} />
          ))}
        </div>
      )}
    </section>
  );
}
