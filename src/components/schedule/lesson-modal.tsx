"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, CalendarPlus, Check, X } from "lucide-react";
import { toast } from "sonner";

import { SelectField } from "@/components/ui/form-controls";
import { TextField } from "@/components/ui/field";
import { apiRequest } from "@/lib/client-api";
import {
  GRADES,
  GRADE_LABELS,
  validateCreateLesson,
  type GradeCode,
  type ScheduleConflictInfo,
} from "@/lib/schedule-rules";
import { subjectTint } from "@/lib/subjects";
import { cn } from "@/lib/utils";
import { DAY_LABELS, type DayOfWeek, type Schedule, type Subject } from "@/types";

interface LessonModalProps {
  open: boolean;
  subjects: Subject[];
  defaultDay: DayOfWeek;
  onClose: () => void;
  onCreated: (lesson: Schedule) => void;
}

interface FormState {
  subjectId: string;
  grade: GradeCode;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  room: string;
}

const CONFLICT_KIND_LABELS: Record<ScheduleConflictInfo["kind"], string> = {
  grade: "класс занят",
  teacher: "вы заняты",
  room: "кабинет занят",
};

const WORK_DAYS: DayOfWeek[] = [1, 2, 3, 4, 5, 6];

function buildInitialForm(subjects: Subject[], day: DayOfWeek): FormState {
  return {
    subjectId: subjects[0]?.id ?? "",
    grade: "GRADE_5",
    dayOfWeek: String(day),
    startTime: "08:30",
    endTime: "09:15",
    room: "",
  };
}

/** Модалка «+ урок»: предмет, класс, день, время и кабинет. Проверка пересечений — на сервере. */
export function LessonModal({ open, subjects, defaultDay, onClose, onCreated }: LessonModalProps) {
  const [form, setForm] = useState<FormState>(() => buildInitialForm(subjects, defaultDay));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<ScheduleConflictInfo[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Каждое открытие начинаем с чистой формы и текущего дня.
  useEffect(() => {
    if (!open) return;
    setForm(buildInitialForm(subjects, defaultDay));
    setErrors({});
    setConflicts([]);
  }, [open, subjects, defaultDay]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, submitting]);

  if (!open) return null;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key === "startTime" || key === "endTime" ? "time" : key];
      return next;
    });
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const payload = {
      subjectId: form.subjectId,
      grade: form.grade,
      dayOfWeek: Number(form.dayOfWeek),
      startTime: form.startTime,
      endTime: form.endTime,
      room: form.room,
    };

    // Та же функция, что и на сервере: ошибки видны сразу, без лишнего запроса.
    const validation = validateCreateLesson(payload);
    if (!validation.ok) {
      setErrors(validation.fields ?? {});
      return;
    }

    setSubmitting(true);
    setConflicts([]);
    const result = await apiRequest<{ lesson: Schedule }>("/api/schedule", { json: payload });
    setSubmitting(false);

    if (!result.ok) {
      if (result.status === 409) {
        const details = result.details as { conflicts?: ScheduleConflictInfo[] } | undefined;
        setConflicts(details?.conflicts ?? []);
      }
      setErrors({ ...result.fields });
      toast.error(result.error);
      return;
    }

    toast.success("Урок добавлен в расписание", {
      description: `Комната создана: ${result.data.lesson.meetingCode}`,
    });
    onCreated(result.data.lesson);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Затемняющий оверлей — слой ниже диалога (z-90 против z-100). */}
      <div
        aria-hidden
        onClick={() => {
          if (!submitting) onClose();
        }}
        className="absolute inset-0 z-[90] bg-black/60 backdrop-blur"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-modal-title"
        className="ring-gradient glass-card animate-fade-up relative z-[100] max-h-[90vh] w-full max-w-lg overflow-y-auto bg-ink-900/95 p-6 shadow-glow"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="lesson-modal-title" className="flex items-center gap-2 text-lg font-semibold text-white">
              <CalendarPlus className="h-5 w-5 text-brand-300" />
              Новый урок
            </h2>
            <p className="mt-1 text-xs text-slate-400">Урок появится в расписании класса и получит комнату для входа.</p>
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

        <form onSubmit={handleSubmit} noValidate className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <SubjectPicker
              subjects={subjects}
              value={form.subjectId}
              error={errors.subjectId}
              onChange={(subjectId) => update("subjectId", subjectId)}
            />
          </div>

          <SelectField
            label="Класс"
            value={form.grade}
            onChange={(event) => update("grade", event.target.value as GradeCode)}
            error={errors.grade}
          >
            {GRADES.map((grade) => (
              <option key={grade} value={grade} className="bg-ink-900">
                {GRADE_LABELS[grade]}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="День недели"
            value={form.dayOfWeek}
            onChange={(event) => update("dayOfWeek", event.target.value)}
            error={errors.dayOfWeek}
          >
            {WORK_DAYS.map((day) => (
              <option key={day} value={day} className="bg-ink-900">
                {DAY_LABELS[day]}
              </option>
            ))}
          </SelectField>

          <TextField
            label="Начало"
            type="time"
            value={form.startTime}
            onChange={(event) => update("startTime", event.target.value)}
            error={errors.time}
          />
          <TextField
            label="Окончание"
            type="time"
            value={form.endTime}
            onChange={(event) => update("endTime", event.target.value)}
            error={errors.time}
          />

          <div className="sm:col-span-2">
            <TextField
              label="Кабинет (необязательно)"
              placeholder="каб. 204 или «онлайн»"
              value={form.room}
              maxLength={40}
              onChange={(event) => update("room", event.target.value)}
              error={errors.room}
            />
          </div>

          {conflicts.length > 0 && (
            <div role="alert" className="sm:col-span-2 animate-fade-in rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-100">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Время занято
              </p>
              <ul className="mt-2 space-y-1 text-xs text-rose-200/90">
                {conflicts.map((conflict) => (
                  <li key={`${conflict.lessonId}-${conflict.kind}`}>
                    {conflict.startTime}–{conflict.endTime} · {conflict.subjectName} · {GRADE_LABELS[conflict.grade]} ·{" "}
                    {conflict.teacherName} — {CONFLICT_KIND_LABELS[conflict.kind]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="sm:col-span-2 flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
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
              disabled={submitting || subjects.length === 0}
              className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Сохраняем…" : "Добавить урок"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Выбор предмета                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Сетка карточек предметов: крупные кликабельные плитки с эмодзи и фирменным
 * цветом предмета. Один клик надёжно фиксирует `subjectId` в форме (кнопки
 * внутри `radiogroup`), поэтому урок всегда уходит в API с выбранным предметом.
 */
function SubjectPicker({
  subjects,
  value,
  error,
  onChange,
}: {
  subjects: Subject[];
  value: string;
  error?: string;
  onChange: (subjectId: string) => void;
}) {
  const selected = subjects.find((subject) => subject.id === value) ?? null;

  return (
    <fieldset>
      <legend className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
        Предмет
        {selected ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11px] normal-case tracking-normal text-slate-200">
            <span aria-hidden>{selected.emoji}</span>
            {selected.name}
          </span>
        ) : null}
      </legend>

      {subjects.length === 0 ? (
        <p className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
          Каталог предметов пуст. Обновите страницу — список создаётся автоматически; также можно
          наполнить его командой <span className="font-mono">npm run db:seed</span>.
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Предмет"
          className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:max-h-64 sm:grid-cols-3"
        >
          {subjects.map((subject) => {
            const isSelected = subject.id === value;

            return (
              <button
                key={subject.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onChange(subject.id)}
                style={
                  isSelected
                    ? {
                        borderColor: subject.color,
                        background: subjectTint(subject.color, 0.22),
                        boxShadow: `0 0 0 1px ${subjectTint(subject.color, 0.5)}`,
                      }
                    : { borderColor: subjectTint(subject.color, 0.35) }
                }
                className={cn(
                  "flex items-center gap-2 rounded-2xl border px-2.5 py-2 text-left transition",
                  isSelected
                    ? "text-white"
                    : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]",
                )}
              >
                <span
                  aria-hidden
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base"
                  style={{ background: subjectTint(subject.color, 0.24) }}
                >
                  {subject.emoji}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold leading-tight">
                  {subject.name}
                </span>
                {isSelected ? (
                  <Check className="h-4 w-4 shrink-0" style={{ color: subject.color }} />
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </fieldset>
  );
}
