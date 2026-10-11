"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Pencil, Plus, Send } from "lucide-react";
import { toast } from "sonner";

import { TextAreaField, SelectField } from "@/components/ui/form-controls";
import { FormAlert } from "@/components/ui/form-alert";
import { GradientButton } from "@/components/ui/gradient-button";
import { TextField } from "@/components/ui/field";
import type { AnnouncementDto } from "@/lib/announcements";
import { apiRequest } from "@/lib/client-api";
import { GRADES, GRADE_LABELS, type GradeCode } from "@/lib/schedule-rules";
import { cn } from "@/lib/utils";

const TITLE_MAX = 120;
const CONTENT_MAX = 2000;

interface AnnouncementModalProps {
  /** Открыть модалку для редактирования существующего объявления. */
  initial?: AnnouncementDto;
  /** Кнопка-триггер: текст и иконка настраиваются. */
  triggerLabel?: string;
  triggerIcon?: "plus" | "pencil";
  triggerClassName?: string;
}

interface FormState {
  title: string;
  content: string;
  targetGrade: GradeCode | "ALL";
  isActive: boolean;
}

function toFormState(initial?: AnnouncementDto): FormState {
  return {
    title: initial?.title ?? "",
    content: initial?.content ?? "",
    targetGrade: initial?.targetGrade ?? "ALL",
    isActive: initial?.isActive ?? true,
  };
}

/**
 * Модалка создания и редактирования объявления.
 *
 * Правила валидации дублируют серверные (`src/lib/announcements.ts`), поэтому
 * пользователь видит ошибку сразу, а сервер остаётся последней инстанцией.
 */
export function AnnouncementModalButton({
  initial,
  triggerLabel,
  triggerIcon = "plus",
  triggerClassName,
}: AnnouncementModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => toFormState(initial));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isEdit = Boolean(initial);
  const Icon = triggerIcon === "pencil" ? Pencil : Plus;

  /* Сбрасываем форму при каждом открытии — модалка живёт между открытиями. */
  useEffect(() => {
    if (open) {
      setForm(toFormState(initial));
      setFields({});
      setError(null);
    }
  }, [open, initial]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    const title = form.title.trim();
    const content = form.content.trim();

    if (title.length < 3) next.title = "Минимум 3 символа";
    else if (title.length > TITLE_MAX) next.title = `Максимум ${TITLE_MAX} символов`;
    if (content.length < 3) next.content = "Напишите текст объявления";
    else if (content.length > CONTENT_MAX) next.content = `Максимум ${CONTENT_MAX} символов`;

    setFields(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    setError(null);
    if (!validate()) return;

    setPending(true);
    const payload = {
      title: form.title.trim(),
      content: form.content.trim(),
      targetGrade: form.targetGrade === "ALL" ? null : form.targetGrade,
      isActive: form.isActive,
    };

    const result = isEdit && initial
      ? await apiRequest<{ announcement: AnnouncementDto }>(`/api/admin/announcements/${initial.id}`, {
          method: "PATCH",
          json: payload,
        })
      : await apiRequest<{ announcement: AnnouncementDto }>("/api/admin/announcements", {
          method: "POST",
          json: payload,
        });

    setPending(false);

    if (!result.ok) {
      setFields(result.fields ?? {});
      setError(result.error);
      toast.error(result.error);
      return;
    }

    toast.success(isEdit ? "Объявление обновлено" : "Объявление опубликовано");
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
          triggerClassName ??
            "bg-brand-gradient text-white shadow-glow hover:scale-[1.02]",
        )}
      >
        <Icon className="h-4 w-4" />
        {triggerLabel ?? (isEdit ? "Изменить" : "Создать объявление")}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isEdit ? "Редактирование объявления" : "Новое объявление"}
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur sm:items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="glass-strong animate-fade-up my-auto w-full max-w-2xl rounded-3xl p-6 shadow-glow sm:p-7">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
                <Megaphone className="h-5 w-5 text-white" />
              </span>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-white">
                  {isEdit ? "Редактирование объявления" : "Новое объявление"}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Активные объявления показываются баннером в кабинете учеников и учителей.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {error && <FormAlert variant="error">{error}</FormAlert>}

              <TextField
                label="Заголовок"
                value={form.title}
                maxLength={TITLE_MAX}
                error={fields.title}
                placeholder="Например: Родительское собрание в пятницу"
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              />

              <TextAreaField
                label="Текст объявления"
                value={form.content}
                maxLength={CONTENT_MAX}
                error={fields.content}
                hint="Поддерживается Markdown и формулы LaTeX ($…$)."
                placeholder="Кому, когда и во сколько приходить…"
                onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Аудитория"
                  value={form.targetGrade}
                  error={fields.targetGrade}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, targetGrade: event.target.value as GradeCode | "ALL" }))
                  }
                >
                  <option value="ALL">Вся школа</option>
                  {GRADES.map((grade) => (
                    <option key={grade} value={grade}>
                      {GRADE_LABELS[grade]}
                    </option>
                  ))}
                </SelectField>

                <div className="space-y-1.5">
                  <span className="block text-xs font-medium uppercase tracking-wider text-slate-400">
                    Статус
                  </span>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-3 text-sm text-slate-200 transition hover:border-white/20">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                      className="h-4 w-4 accent-brand-500"
                    />
                    Показывать в кабинете
                  </label>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
                <GradientButton
                  type="button"
                  loading={pending}
                  loadingText="Сохраняем…"
                  icon={Send}
                  fullWidth={false}
                  className="flex-1 sm:flex-none sm:px-8"
                  onClick={() => void submit()}
                >
                  {isEdit ? "Сохранить" : "Опубликовать"}
                </GradientButton>

                <button
                  type="button"
                  onClick={close}
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
