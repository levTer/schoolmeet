import Link from "next/link";
import { BookOpen, CheckCircle2, Clock3 } from "lucide-react";

import { DeadlineBadge } from "@/components/homework/deadline-badge";
import { GRADE_LABELS, type GradeCode } from "@/lib/schedule-rules";
import { cn } from "@/lib/utils";
import { SUBMISSION_STATUS_LABELS, type HomeworkListItem } from "@/types";

interface HomeworkCardProps {
  item: HomeworkListItem;
  viewerRole: "STUDENT" | "TEACHER" | "ADMIN";
  index: number;
}

/** Карточка задания в списке: предмет, дедлайн, статус ученика или статистика сдачи учителю. */
export function HomeworkCard({ item, viewerRole, index }: HomeworkCardProps) {
  const color = item.subject.color;
  const submission = item.mySubmission;
  const isStudent = viewerRole === "STUDENT";
  const isClosed = submission?.status === "SUBMITTED" || submission?.status === "GRADED";

  return (
    <Link
      href={`/homework/${item.id}`}
      style={{ animationDelay: `${60 + index * 50}ms` }}
      className="ring-gradient glass-card animate-fade-up group relative overflow-hidden p-5 hover:bg-white/[0.05]"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 opacity-80"
        style={{ background: `linear-gradient(90deg, ${color}, ${color}33)` }}
      />

      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl shadow-inner-top"
          style={{ background: `linear-gradient(135deg, ${color}E6, ${color}55)` }}
        >
          {item.subject.emoji}
        </span>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-slate-400">
            {item.subject.name} · {item.className ?? GRADE_LABELS[item.grade as GradeCode]}
          </p>
          <h3 className="mt-0.5 truncate text-base font-semibold text-white">{item.title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {item.teacher.name} · макс. {item.maxScore}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isStudent && isClosed && submission ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
            <Clock3 className="h-3 w-3" />
            {submission.status === "GRADED" && submission.grade !== null
              ? `Оценка: ${submission.grade} / ${item.maxScore}`
              : SUBMISSION_STATUS_LABELS[submission.status]}
          </span>
        ) : isStudent ? (
          <DeadlineBadge deadline={item.deadline} />
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300">
            <BookOpen className="h-3 w-3" />
            Сдано {item.stats?.submitted ?? 0} из {item.stats?.total ?? 0}
          </span>
        )}

        {!isStudent && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
            На проверке: {(item.stats?.submitted ?? 0) - (item.stats?.graded ?? 0)}
          </span>
        )}

        {!isStudent && <DeadlineBadge deadline={item.deadline} />}

        {isStudent && isClosed && submission?.status === "GRADED" && (
          <CheckCircle2 className={cn("h-4 w-4 text-emerald-300")} aria-label="Оценено" />
        )}
      </div>
    </Link>
  );
}
