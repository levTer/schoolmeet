"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, Download, Lock, Loader2, Paperclip, Send, Users } from "lucide-react";
import { toast } from "sonner";

import { TextField } from "@/components/ui/field";
import { TextAreaField } from "@/components/ui/form-controls";
import { MarkdownMath } from "@/components/ui/markdown-math";
import { apiRequest } from "@/lib/client-api";
import { parseGrade } from "@/lib/homework-rules";
import { SCHOOL_TIMEZONE } from "@/lib/schedule-rules";
import { cn } from "@/lib/utils";
import {
  SUBMISSION_STATUS_LABELS,
  type HomeworkDetailInfo,
  type HomeworkSubmissionStatus,
  type TeacherReviewInfo,
  type TeacherSubmissionInfo,
} from "@/types";

import { DeadlineBadge } from "./deadline-badge";

interface TeacherHomeworkViewProps {
  homework: HomeworkDetailInfo;
  submissions: TeacherSubmissionInfo[];
  missingStudents: { id: string; name: string }[];
}

interface ReviewEdit {
  grade: string;
  comment: string;
}

const STATUS_CHIP: Record<HomeworkSubmissionStatus, string> = {
  DRAFT: "border-white/10 bg-white/[0.04] text-slate-300",
  SUBMITTED: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  GRADED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: SCHOOL_TIMEZONE,
  });
}

/** Проверка учителя: список работ, черновик ИИ (только для учителя) и утверждение оценки. */
export function TeacherHomeworkView({ homework, submissions, missingStudents }: TeacherHomeworkViewProps) {
  const router = useRouter();

  const firstToReview = submissions.find((item) => item.status === "SUBMITTED") ?? submissions[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstToReview?.id ?? null);
  const [reviews, setReviews] = useState<Record<string, TeacherReviewInfo | null>>({});
  const [edits, setEdits] = useState<Record<string, ReviewEdit>>({});
  const [busy, setBusy] = useState<"ai" | "approve" | null>(null);

  const selected = useMemo(() => submissions.find((item) => item.id === selectedId) ?? null, [submissions, selectedId]);

  const reviewOf = (submission: TeacherSubmissionInfo): TeacherReviewInfo | null =>
    Object.prototype.hasOwnProperty.call(reviews, submission.id) ? reviews[submission.id] : submission.review;

  const counts = useMemo(
    () => ({
      submitted: submissions.length,
      toReview: submissions.filter((item) => item.status === "SUBMITTED").length,
      graded: submissions.filter((item) => item.status === "GRADED").length,
    }),
    [submissions],
  );

  const editFor = (submission: TeacherSubmissionInfo, review: TeacherReviewInfo | null): ReviewEdit =>
    edits[submission.id] ?? {
      grade: String(review?.grade ?? review?.aiSuggestedGrade ?? ""),
      comment: review?.comment ?? review?.aiDraftComment ?? "",
    };

  const updateEdit = (submission: TeacherSubmissionInfo, patch: Partial<ReviewEdit>, review: TeacherReviewInfo | null) => {
    setEdits((current) => ({ ...current, [submission.id]: { ...editFor(submission, review), ...patch } }));
  };

  async function generateDraft(submission: TeacherSubmissionInfo) {
    setBusy("ai");
    const result = await apiRequest<{ review: TeacherReviewInfo }>(`/api/homework/${homework.id}/ai-review`, {
      json: { submissionId: submission.id },
    });
    setBusy(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    const draft = result.data.review;
    setReviews((current) => ({ ...current, [submission.id]: draft }));
    setEdits((current) => ({
      ...current,
      [submission.id]: { grade: String(draft.aiSuggestedGrade ?? ""), comment: draft.aiDraftComment ?? "" },
    }));
    toast.success("Черновик ИИ готов", { description: "Он виден только вам. Проверьте текст и утвердите оценку." });
  }

  async function approve(submission: TeacherSubmissionInfo, review: TeacherReviewInfo | null) {
    const edit = editFor(submission, review);
    const grade = parseGrade(edit.grade, homework.maxScore);
    if (grade === null) {
      toast.error(`Укажите оценку от 1 до ${homework.maxScore}`);
      return;
    }

    setBusy("approve");
    const result = await apiRequest<{ review: TeacherReviewInfo }>(`/api/homework/${homework.id}/grade`, {
      json: { submissionId: submission.id, grade, comment: edit.comment },
    });
    setBusy(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setReviews((current) => ({ ...current, [submission.id]: result.data.review }));
    toast.success("Оценка отправлена ученику", { description: `${submission.student.name}: ${grade} / ${homework.maxScore}` });
    router.refresh();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      {/* Список работ */}
      <aside className="space-y-4">
        <section className="ring-gradient glass-card animate-fade-up p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Сдачи</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">Сдано: {counts.submitted}</span>
            <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-amber-200">На проверке: {counts.toReview}</span>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-emerald-200">Оценено: {counts.graded}</span>
          </div>

          {submissions.length === 0 ? (
            <p className="mt-5 text-sm text-slate-400">Пока никто не сдал работу.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {submissions.map((submission) => {
                const review = reviewOf(submission);
                const active = submission.id === selectedId;
                return (
                  <li key={submission.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(submission.id)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "w-full rounded-2xl border px-3.5 py-3 text-left transition",
                        active ? "border-brand-400/40 bg-brand-500/15" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-white">{submission.student.name}</span>
                        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px]", STATUS_CHIP[submission.status])}>
                          {SUBMISSION_STATUS_LABELS[submission.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDateTime(submission.submittedAt)}
                        {review?.approvedAt && review.grade !== null ? ` · оценка ${review.grade}/${homework.maxScore}` : ""}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="glass-card p-5">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Users className="h-3.5 w-3.5" />
            Ещё не сдали ({missingStudents.length})
          </h2>
          {missingStudents.length === 0 ? (
            <p className="mt-3 text-sm text-emerald-200/90">Весь класс сдал работу.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {missingStudents.map((student) => (
                <li key={student.id} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300">
                  {student.name}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      {/* Детали выбранной работы */}
      <section className="ring-gradient glass-card animate-fade-up min-w-0 p-6">
        {!selected ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-slate-400">
            <Users className="h-8 w-8 text-brand-300" />
            <p>Выберите работу слева, чтобы проверить её.</p>
          </div>
        ) : (
          <SubmissionReview
            homework={homework}
            submission={selected}
            review={reviewOf(selected)}
            edit={editFor(selected, reviewOf(selected))}
            busy={busy}
            onEdit={(patch) => updateEdit(selected, patch, reviewOf(selected))}
            onGenerate={() => void generateDraft(selected)}
            onApprove={() => void approve(selected, reviewOf(selected))}
          />
        )}

        <div className="mt-8 border-t border-white/5 pt-4">
          <p className="text-xs text-slate-500">Условие задания</p>
          <div className="mt-3 max-h-64 overflow-y-auto rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <MarkdownMath text={homework.description} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <DeadlineBadge deadline={homework.deadline} />
            <Link href="/homework" className="transition hover:text-white">
              ← К списку заданий
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

interface SubmissionReviewProps {
  homework: HomeworkDetailInfo;
  submission: TeacherSubmissionInfo;
  review: TeacherReviewInfo | null;
  edit: ReviewEdit;
  busy: "ai" | "approve" | null;
  onEdit: (patch: Partial<ReviewEdit>) => void;
  onGenerate: () => void;
  onApprove: () => void;
}

function SubmissionReview({ homework, submission, review, edit, busy, onEdit, onGenerate, onApprove }: SubmissionReviewProps) {
  const approved = Boolean(review?.approvedAt);
  const hasDraft = Boolean(review?.aiDraftedAt);
  const gradeValue = parseGrade(edit.grade, homework.maxScore);
  const late = Boolean(submission.submittedAt && new Date(submission.submittedAt) > new Date(homework.deadline));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{submission.student.name}</h2>
          <p className="mt-1 text-xs text-slate-400">
            Сдано: {formatDateTime(submission.submittedAt)}
            {late && <span className="ml-2 text-rose-300">· с опозданием</span>}
          </p>
        </div>
        <span className={cn("rounded-full border px-3 py-1 text-xs", STATUS_CHIP[submission.status])}>
          {SUBMISSION_STATUS_LABELS[submission.status]}
        </span>
      </header>

      {/* Ответ ученика */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Ответ ученика</p>
        <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-ink-900/60 p-4 text-sm leading-relaxed text-slate-100">
          {submission.answer.trim() || <span className="text-slate-500">Текстового ответа нет.</span>}
        </div>
      </div>

      {submission.attachments.length > 0 && (
        <ul className="space-y-2">
          {submission.attachments.map((attachment) => (
            <li key={attachment.id}>
              <a
                href={`/api/homework/${homework.id}/files/${attachment.id}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-200 transition hover:bg-white/[0.06]"
              >
                <Paperclip className="h-4 w-4 text-slate-500" />
                <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
                <Download className="h-4 w-4 text-slate-400" />
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* Итог, если уже утверждён */}
      {approved && review && (
        <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
            <CheckCircle2 className="h-4 w-4" />
            Оценка отправлена ученику: {review.grade} / {homework.maxScore}
          </p>
          {review.comment && <p className="mt-2 whitespace-pre-line text-sm text-emerald-50/90">{review.comment}</p>}
        </div>
      )}

      {/* Черновик ИИ и утверждение */}
      {!approved && (
        <div className="space-y-4 rounded-2xl border border-violet-400/25 bg-violet-500/[0.06] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-violet-100">
              <Bot className="h-4 w-4" />
              Проверка учителя
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/30 bg-violet-400/10 px-2.5 py-1 text-[11px] font-medium text-violet-100">
              <Lock className="h-3 w-3" />
              🔒 Черновик ИИ (виден только вам)
            </span>
          </div>

          <button
            type="button"
            onClick={onGenerate}
            disabled={busy !== null || submission.status !== "SUBMITTED"}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-300/30 bg-violet-400/10 px-4 py-2 text-sm font-medium text-violet-50 transition hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            {hasDraft ? "🤖 Пересоздать черновик ИИ" : "🤖 Сгенерировать черновик ИИ"}
          </button>

          {hasDraft && review?.aiSuggestedGrade != null && (
            <p className="text-xs text-violet-200/80">
              Предложение ИИ: <span className="font-semibold text-white">{review.aiSuggestedGrade} / {homework.maxScore}</span>. Ученик его не видит,
              пока вы не утвердите оценку.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <TextField
              label={`Оценка (1–${homework.maxScore})`}
              type="number"
              inputMode="numeric"
              min={1}
              max={homework.maxScore}
              step={1}
              value={edit.grade}
              onChange={(event) => onEdit({ grade: event.target.value })}
              error={edit.grade !== "" && gradeValue === null ? `От 1 до ${homework.maxScore}` : undefined}
            />
            <TextAreaField
              label="Комментарий ученику"
              value={edit.comment}
              maxLength={2000}
              rows={4}
              onChange={(event) => onEdit({ comment: event.target.value })}
              hint={hasDraft ? "Текст черновика можно править перед отправкой." : "Комментарий необязателен."}
            />
          </div>

          {submission.status !== "SUBMITTED" && (
            <p className="flex items-center gap-2 text-xs text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5" /> Работа ещё не находится на проверке.
            </p>
          )}

          <button
            type="button"
            onClick={onApprove}
            disabled={busy !== null || gradeValue === null || submission.status !== "SUBMITTED"}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-brand-contrast shadow-glow transition hover:scale-[1.005] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Утвердить и отправить
          </button>
        </div>
      )}
    </div>
  );
}
