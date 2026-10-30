import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft } from "lucide-react";

import { DeadlineBadge } from "@/components/homework/deadline-badge";
import { StudentHomeworkView } from "@/components/homework/student-homework-view";
import { TeacherHomeworkView } from "@/components/homework/teacher-homework-view";
import { AppShell } from "@/components/layout/app-shell";
import { authOptions } from "@/lib/auth";
import { getHomeworkDetailForViewer } from "@/lib/homework";
import { getSchoolViewer } from "@/lib/school-viewer";
import { GRADE_LABELS, type GradeCode } from "@/lib/schedule-rules";

export const metadata: Metadata = {
  title: "Домашнее задание",
};

export const dynamic = "force-dynamic";

interface HomeworkPageProps {
  params: Promise<{ id: string }>;
}

/** Карточка задания: для ученика — сдача, для учителя — проверка. Доступ проверяется на сервере. */
export default async function HomeworkDetailPage({ params }: HomeworkPageProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(`/homework/${id}`)}`);

  const viewer = await getSchoolViewer(session.user.id);
  if (!viewer) redirect("/login");

  const detail = await getHomeworkDetailForViewer(id, viewer);
  if (!detail) notFound();

  const { homework } = detail;
  const subjectColor = homework.subject.color;

  return (
    <AppShell>
      <header className="animate-fade-up">
        <Link href="/homework" className="inline-flex items-center gap-2 text-xs text-slate-400 transition hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" />
          Все задания
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <span
              aria-hidden
              className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl shadow-inner-top"
              style={{ background: `linear-gradient(135deg, ${subjectColor}E6, ${subjectColor}55)` }}
            >
              {homework.subject.emoji}
            </span>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">
                {homework.subject.name} · {GRADE_LABELS[homework.grade as GradeCode]} · {homework.teacher.name}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{homework.title}</h1>
            </div>
          </div>
          <DeadlineBadge deadline={homework.deadline} />
        </div>
      </header>

      <div className="mt-8">
        {detail.view === "student" ? (
          <StudentHomeworkView homework={homework} submission={detail.submission} />
        ) : (
          <TeacherHomeworkView
            homework={homework}
            submissions={detail.submissions}
            missingStudents={detail.missingStudents}
          />
        )}
      </div>
    </AppShell>
  );
}
