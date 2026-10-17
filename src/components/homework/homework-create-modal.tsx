"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { useHomeworkCreateModal } from "@/components/homework/homework-create-store";
import { TextField } from "@/components/ui/field";
import { SelectField, TextAreaField } from "@/components/ui/form-controls";
import { Modal } from "@/components/ui/modal";
import { apiRequest } from "@/lib/client-api";
import { HOMEWORK_LIMITS, validateCreateHomework } from "@/lib/homework-rules";
import { formatSchoolLocalInput, schoolLocalToDate, type GradeCode } from "@/lib/schedule-rules";
import type { SchoolClassOption } from "@/lib/schools";
import type { Subject } from "@/types";

interface HomeworkCreateModalProps {
  open: boolean;
  subjects: Subject[];
  classes: SchoolClassOption[];
  onClose: () => void;
}

interface FormState {
  title: string;
  subjectId: string;
  classId: string;
  grade: GradeCode;
  deadline: string;
  maxScore: string;
  description: string;
}

function defaultDeadline(): string {
  // По умолчанию — через трое суток, в 18:00 по времени школы.
  const date = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  return formatSchoolLocalInput(date).replace(/T\d{2}:\d{2}$/, "T18:00");
}

function buildInitialForm(subjects: Subject[], classes: SchoolClassOption[]): FormState {
  return {
    title: "",
    subjectId: subjects[0]?.id ?? "",
    classId: classes[0]?.id ?? "",
    grade: classes[0]?.grade ?? "GRADE_5",
    deadline: defaultDeadline(),
    maxScore: String(HOMEWORK_LIMITS.defaultMaxScore),
    description: "",
  };
}

/** Кнопка и модалка выдачи задания классу (учитель). */
export function HomeworkCreateButton({ subjects, classes }: { subjects: Subject[]; classes: SchoolClassOption[] }) {
  /* Состояние живёт в общем store: о модалке знает и пустышка списка заданий. */
  const open = useHomeworkCreateModal((state) => state.open);
  const setOpen = useHomeworkCreateModal((state) => state.setOpen);

  // Уход со страницы с открытой модалкой не должен «замораживать» пустышку.
  useEffect(() => () => setOpen(false), [setOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.02]"
      >
        <Plus className="h-4 w-4" />
        Новое задание
      </button>
      <HomeworkCreateModal open={open} subjects={subjects} classes={classes} onClose={() => setOpen(false)} />
    </>
  );
}

export function HomeworkCreateModal({ open, subjects, classes, onClose }: HomeworkCreateModalProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => buildInitialForm(subjects, classes));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;

    wasOpen.current = true;
    setForm(buildInitialForm(subjects, classes));
    setErrors({});
  }, [open, subjects, classes]);

  const descriptionLength = form.description.length;
  const minDeadline = formatSchoolLocalInput(new Date());

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    if (!form.title.trim()) {
      setErrors((current) => ({ ...current, title: "Введите название задания" }));
      return;
    }

    const deadline = schoolLocalToDate(form.deadline);
    const payload = {
      title: form.title,
      description: form.description,
      subjectId: form.subjectId,
      classId: form.classId,
      grade: form.grade,
      deadline: deadline?.toISOString() ?? form.deadline,
      maxScore: Number(form.maxScore),
    };

    const validation = validateCreateHomework(payload, new Date());
    if (!validation.ok) {
      setErrors(validation.fields ?? {});
      return;
    }

    setSubmitting(true);
    const result = await apiRequest<{ homework: { id: string } }>("/api/homework", { json: payload });
    setSubmitting(false);

    if (!result.ok) {
      setErrors(result.fields ?? {});
      toast.error(result.error);
      return;
    }

    toast.success("Задание выдано классу", { description: "Ученики увидят его в разделе «Домашние задания»." });
    setForm(buildInitialForm(subjects, classes));
    setErrors({});
    onClose();
    router.refresh();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      disableClose={submitting}
      labelledBy="homework-modal-title"
      /*
       * Гармоничный баланс карточки: не вылезает за экран, не растянута на всю
       * ширину. Ширина — до 3xl/4xl, высота — не больше 85% экрана, внутренняя
       * часть скроллится, а шапка и кнопки остаются на виду.
       */
      className="w-full max-w-3xl md:max-w-4xl sm:max-w-3xl max-h-[85vh] flex flex-col p-0"
    >
      {/* Шапка: заголовок окна закреплён и ничего не перекрывает */}
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-6 pb-4 pt-5">
        <div>
          <h2 id="homework-modal-title" className="flex items-center gap-2 text-lg font-semibold text-white">
            <CalendarPlus className="h-5 w-5 text-brand-300" />
            Новое домашнее задание
          </h2>
          <p className="mt-1 text-xs text-slate-400">Условие можно писать в Markdown и вставлять формулы LaTeX: $x^2$ или $$…$$.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Закрыть"
          className="rounded-full p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Прокручиваемая область: вся форма живёт здесь, отступ сверху — pt-2 */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
        <form id="homework-create-form" onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="pt-2 sm:col-span-2">
            <TextField
              label="Название задания"
              value={form.title}
              maxLength={HOMEWORK_LIMITS.titleMax}
              onChange={(event) => update("title", event.target.value)}
              error={errors.title}
            />
          </div>

          <SelectField
            label="Предмет"
            value={form.subjectId}
            onChange={(event) => update("subjectId", event.target.value)}
            error={errors.subjectId}
          >
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id} className="bg-ink-900">
                {subject.emoji} {subject.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Класс"
            value={form.classId}
            onChange={(event) => {
              const selected = classes.find((schoolClass) => schoolClass.id === event.target.value);
              if (!selected) return;
              update("classId", selected.id);
              update("grade", selected.grade);
            }}
            error={errors.classId}
          >
            {classes.length === 0 ? (
              <option value="" className="bg-ink-900">
                Нет доступных классов
              </option>
            ) : (
              classes.map((schoolClass) => (
                <option key={schoolClass.id} value={schoolClass.id} className="bg-ink-900">
                  {schoolClass.name}
                </option>
              ))
            )}
          </SelectField>

          <TextField
            label="Дедлайн (время школы)"
            type="datetime-local"
            min={minDeadline}
            value={form.deadline}
            onChange={(event) => update("deadline", event.target.value)}
            error={errors.deadline}
          />

          <SelectField
            label="Максимальный балл"
            value={form.maxScore}
            onChange={(event) => update("maxScore", event.target.value)}
            error={errors.maxScore}
          >
            {Array.from({ length: HOMEWORK_LIMITS.maxScoreMax - HOMEWORK_LIMITS.maxScoreMin + 1 }, (_, index) => {
              const value = HOMEWORK_LIMITS.maxScoreMin + index;
              return (
                <option key={value} value={value} className="bg-ink-900">
                  {value}
                </option>
              );
            })}
          </SelectField>

          <div className="sm:col-span-2">
            <TextAreaField
              label="Условие"
              value={form.description}
              maxLength={HOMEWORK_LIMITS.descriptionMax}
              onChange={(event) => update("description", event.target.value)}
              error={errors.description}
              hint={`${descriptionLength} / ${HOMEWORK_LIMITS.descriptionMax}`}
              placeholder={"## Задание\n\nРешите уравнение $x^2 - 5x + 6 = 0$"}
              rows={7}
            />
          </div>
        </form>
      </div>

      {/* Действия закреплены внизу карточки — их всегда видно */}
      <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-white/10 px-6 py-4 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
        >
          Отмена
        </button>
        <button
          type="submit"
          form="homework-create-form"
          disabled={submitting || subjects.length === 0 || classes.length === 0}
          className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Создание..." : "Выдать задание"}
        </button>
      </div>
    </Modal>
  );
}
