"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { CheckCircle2, Clock3, Download, FileText, Loader2, Paperclip, Send, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { MarkdownMath } from "@/components/ui/markdown-math";
import { apiRequest } from "@/lib/client-api";
import { findAllowedFileType, HOMEWORK_LIMITS } from "@/lib/homework-rules";
import { SCHOOL_TIMEZONE } from "@/lib/schedule-rules";
import { cn } from "@/lib/utils";
import {
  SUBMISSION_STATUS_LABELS,
  type HomeworkAttachmentInfo,
  type HomeworkDetailInfo,
  type HomeworkSubmissionStatus,
  type StudentSubmissionInfo,
} from "@/types";

import { DeadlineBadge } from "./deadline-badge";

/** Интервал автосохранения черновика, мс (ТЗ: каждые 10 секунд). */
export const AUTOSAVE_INTERVAL_MS = 10_000;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

interface StudentHomeworkViewProps {
  homework: HomeworkDetailInfo;
  submission: StudentSubmissionInfo | null;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: SCHOOL_TIMEZONE });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/**
 * Страница задания для ученика: условие, ответ с автосохранением, файлы и сдача.
 * Оценку показываем только после утверждения учителем (`submission.approvedAt`).
 */
export function StudentHomeworkView({ homework, submission }: StudentHomeworkViewProps) {
  const router = useRouter();
  const [answer, setAnswer] = useState(submission?.answer ?? "");
  const [attachments, setAttachments] = useState<HomeworkAttachmentInfo[]>(submission?.attachments ?? []);
  const [status, setStatus] = useState<HomeworkSubmissionStatus>(submission?.status ?? "DRAFT");
  const [savedAt, setSavedAt] = useState<string | null>(submission?.draftSavedAt ?? null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [uploading, setUploading] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const answerRef = useRef(answer);
  const savedAnswerRef = useRef(submission?.answer ?? "");
  const saveInFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDraft = status === "DRAFT";
  const isGraded = status === "GRADED" && Boolean(submission?.approvedAt);
  const apiBase = `/api/homework/${homework.id}`;

  // Статус мог измениться на сервере (учитель оценил) — подтягиваем его после refresh.
  useEffect(() => {
    if (submission) setStatus(submission.status);
  }, [submission?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Сохраняет текущий текст, если он изменился. Возвращает false при ошибке. */
  const flushDraft = useCallback(async (): Promise<boolean> => {
    const current = answerRef.current;
    if (current === savedAnswerRef.current) return true;
    if (saveInFlightRef.current) return true;

    saveInFlightRef.current = true;
    setSaveState("saving");
    const result = await apiRequest<{ savedAt: string }>(`${apiBase}/draft`, { method: "PUT", json: { answer: current } });
    saveInFlightRef.current = false;

    if (result.ok) {
      savedAnswerRef.current = current;
      setSavedAt(result.data.savedAt);
      setSaveState(answerRef.current === current ? "saved" : "dirty");
      return true;
    }
    setSaveState("error");
    toast.error("Черновик не сохранён", { description: result.error });
    return false;
  }, [apiBase]);

  // Автосохранение каждые 10 секунд, пока работа в статусе черновика.
  useEffect(() => {
    if (!isDraft) return;
    const timer = window.setInterval(() => {
      void flushDraft();
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isDraft, flushDraft]);

  // Предупреждаем, если уходим с несохранённым текстом.
  useEffect(() => {
    if (!isDraft) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (answerRef.current !== savedAnswerRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDraft]);

  const handleAnswerChange = (value: string) => {
    answerRef.current = value;
    setAnswer(value);
    setSaveState("dirty");
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0 || !isDraft) return;

    const free = HOMEWORK_LIMITS.maxFilesPerSubmission - attachments.length;
    if (free <= 0) {
      toast.error(`Можно прикрепить не больше ${HOMEWORK_LIMITS.maxFilesPerSubmission} файлов`);
      return;
    }

    setUploading((count) => count + Math.min(free, files.length));
    for (const file of files.slice(0, free)) {
      // Быстрая проверка на клиенте; окончательную делает сервер по сигнатуре файла.
      if (!findAllowedFileType(file.name)) {
        toast.error(`${file.name}: формат не поддерживается`, { description: "Допустимы PDF, PNG, JPG, DOCX и TXT." });
        setUploading((count) => count - 1);
        continue;
      }
      if (file.size > HOMEWORK_LIMITS.maxFileBytes) {
        toast.error(`${file.name}: файл больше 10 МБ`);
        setUploading((count) => count - 1);
        continue;
      }

      const form = new FormData();
      form.append("file", file);
      const result = await apiRequest<{ attachment: HomeworkAttachmentInfo }>(`${apiBase}/files`, { form });
      setUploading((count) => count - 1);

      if (result.ok) {
        setAttachments((current) => [...current, result.data.attachment]);
      } else {
        toast.error(`${file.name}: ${result.error}`);
      }
    }
    if (files.length > free) {
      toast.warning(`Прикреплено не больше ${HOMEWORK_LIMITS.maxFilesPerSubmission} файлов`);
    }
  };

  const removeAttachment = async (attachment: HomeworkAttachmentInfo) => {
    const result = await apiRequest<{ deleted: boolean }>(`${apiBase}/files/${attachment.id}`, { method: "DELETE" });
    if (result.ok) {
      setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    } else {
      toast.error(result.error);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  };

  const waitForIdleSave = async () => {
    // Если сохранение уже идёт, дождёмся его, чтобы сдать актуальный текст.
    for (let attempt = 0; attempt < 50 && saveInFlightRef.current; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  const handleSubmit = async () => {
    if (submitting || uploading > 0) return;
    if (!window.confirm("Сдать работу на проверку? После сдачи ответ и файлы нельзя будет изменить.")) return;

    setSubmitting(true);
    await waitForIdleSave();
    const saved = await flushDraft();
    if (!saved) {
      setSubmitting(false);
      return;
    }

    const result = await apiRequest<{ status: HomeworkSubmissionStatus; submittedAt: string; isLate: boolean }>(
      `${apiBase}/submit`,
      { method: "POST" },
    );
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setStatus("SUBMITTED");
    setSaveState("idle");
    toast.success(result.data.isLate ? "Работа сдана с опозданием" : "Работа сдана!", {
      description: "Статус: «На проверке». Оценку увидите после проверки учителем.",
    });
    router.refresh();
  };

  const canSubmit = isDraft && !submitting && uploading === 0 && (answer.trim().length > 0 || attachments.length > 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Условие */}
      <section className="ring-gradient glass-card animate-fade-up p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Условие</h2>
        <div className="mt-4">
          <MarkdownMath text={homework.description} />
        </div>
      </section>

      {/* Ответ */}
      <section className="ring-gradient glass-card animate-fade-up space-y-5 p-6" aria-label="Ваш ответ">
        <StatusPanel
          status={status}
          isDraft={isDraft}
          saveState={saveState}
          savedAt={savedAt}
          submittedAt={submission?.submittedAt ?? null}
          grade={isGraded ? (submission?.grade ?? null) : null}
          maxScore={homework.maxScore}
          comment={isGraded ? (submission?.comment ?? null) : null}
          deadline={homework.deadline}
        />

        <div>
          <label htmlFor="homework-answer" className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
            Ответ
          </label>
          <textarea
            id="homework-answer"
            value={answer}
            onChange={(event) => handleAnswerChange(event.target.value)}
            readOnly={!isDraft}
            maxLength={HOMEWORK_LIMITS.answerMax}
            rows={9}
            placeholder="Запишите решение и ответ. Черновик сохраняется автоматически каждые 10 секунд."
            className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-3 text-sm leading-relaxed text-white outline-none transition placeholder:text-slate-600 focus:border-accent-400/70 focus:ring-4 focus:ring-accent-500/15 read-only:opacity-80"
          />
          <p className="mt-1.5 text-right text-[11px] text-slate-500">
            {answer.length} / {HOMEWORK_LIMITS.answerMax}
          </p>
        </div>

        {/* Файлы */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Файлы</p>

          {isDraft && (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-7 text-center text-sm transition",
                dragActive ? "border-accent-400 bg-accent-500/10 text-white" : "border-white/15 bg-white/[0.02] text-slate-400",
              )}
            >
              <Upload className="h-5 w-5" />
              <p>
                Перетащите файлы сюда или{" "}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="font-medium text-accent-300 underline underline-offset-2"
                >
                  выберите на компьютере
                </button>
              </p>
              <p className="text-xs text-slate-500">PDF, PNG, JPG, DOCX, TXT · до 10 МБ · до {HOMEWORK_LIMITS.maxFilesPerSubmission} файлов</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.docx,.txt,image/png,image/jpeg,application/pdf"
                className="hidden"
                onChange={(event) => {
                  void uploadFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </div>
          )}

          {uploading > 0 && (
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Загружаем файлы: {uploading}
            </p>
          )}

          {attachments.length > 0 ? (
            <ul className="space-y-2">
              {attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm"
                >
                  <Paperclip className="h-4 w-4 shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate text-slate-200">{attachment.fileName}</span>
                  <span className="shrink-0 text-xs text-slate-500">{formatBytes(attachment.size)}</span>
                  <a
                    href={`${apiBase}/files/${attachment.id}`}
                    className="rounded-full p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
                    aria-label={`Скачать ${attachment.fileName}`}
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  {isDraft && (
                    <button
                      type="button"
                      onClick={() => void removeAttachment(attachment)}
                      className="rounded-full p-1.5 text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-200"
                      aria-label={`Удалить ${attachment.fileName}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">Файлов пока нет.</p>
          )}
        </div>

        {isDraft && (
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.005] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? "Сдаём…" : "Сдать работу"}
          </button>
        )}

        <Link href="/homework" className="inline-flex text-xs text-slate-400 transition hover:text-white">
          ← Ко всем заданиям
        </Link>
      </section>
    </div>
  );
}

interface StatusPanelProps {
  status: HomeworkSubmissionStatus;
  isDraft: boolean;
  saveState: SaveState;
  savedAt: string | null;
  submittedAt: string | null;
  grade: number | null;
  maxScore: number;
  comment: string | null;
  deadline: string;
}

function StatusPanel({ status, isDraft, saveState, savedAt, submittedAt, grade, maxScore, comment, deadline }: StatusPanelProps) {
  if (status === "GRADED" && grade !== null) {
    return (
      <div className="animate-fade-in space-y-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          <p className="text-sm font-semibold text-emerald-100">Оценено учителем</p>
          <span className="ml-auto rounded-full bg-emerald-400/20 px-3 py-1 text-lg font-bold text-emerald-100">
            {grade} / {maxScore}
          </span>
        </div>
        {comment && <p className="whitespace-pre-line text-sm leading-relaxed text-emerald-50/90">{comment}</p>}
      </div>
    );
  }

  if (!isDraft) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
        <Clock3 className="h-5 w-5 text-amber-300" />
        <div>
          <p className="text-sm font-semibold text-amber-100">{SUBMISSION_STATUS_LABELS[status]}</p>
          <p className="text-xs text-amber-200/80">
            {submittedAt ? `Сдано в ${formatTime(submittedAt)}. ` : ""}Оценку увидите здесь после проверки учителем.
          </p>
        </div>
      </div>
    );
  }

  const saveText =
    saveState === "saving"
      ? "Сохраняем…"
      : saveState === "dirty"
        ? "Есть несохранённые изменения"
        : saveState === "error"
          ? "Не удалось сохранить — повторим автоматически"
          : savedAt
            ? `Черновик сохранён в ${formatTime(savedAt)}`
            : "Черновик ещё не сохранён";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
          <FileText className="h-3.5 w-3.5" />
          {SUBMISSION_STATUS_LABELS.DRAFT}
        </span>
        <DeadlineBadge deadline={deadline} />
      </div>
      <p className="text-xs text-slate-400" aria-live="polite">
        {saveText}
        {new Date(deadline).getTime() < Date.now() ? " · дедлайн прошёл, работа будет помечена как «с опозданием»" : ""}
      </p>
      {saveState === "error" && (
        <p className="flex items-center gap-1.5 text-xs text-rose-300">
          <X className="h-3 w-3" /> Проверьте соединение: черновик сохранится при следующей попытке.
        </p>
      )}
    </div>
  );
}
