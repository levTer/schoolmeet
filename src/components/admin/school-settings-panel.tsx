"use client";

import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormAlert } from "@/components/ui/form-alert";
import { TextField } from "@/components/ui/field";
import { apiRequest } from "@/lib/client-api";
import type { GradeCode } from "@/lib/schedule-rules";

interface SchoolSettings {
  name: string;
  code: string;
}

interface SchoolClass {
  id: string;
  name: string;
  grade: GradeCode;
}

export function SchoolSettingsPanel({
  school,
  initialClasses,
}: {
  school: SchoolSettings;
  initialClasses: SchoolClass[];
}) {
  const router = useRouter();
  const [classes, setClasses] = useState(initialClasses);
  const [className, setClassName] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(school.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Не удалось скопировать код. Выделите его и скопируйте вручную.");
    }
  }

  async function handleCreateClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldError(undefined);
    setIsCreating(true);

    const result = await apiRequest<{ schoolClass: SchoolClass }>("/api/admin/classes", {
      json: { name: className },
    });
    setIsCreating(false);

    if (!result.ok) {
      setError(result.error);
      setFieldError(result.fields?.name);
      return;
    }

    setClasses((current) =>
      [...current, result.data.schoolClass].sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true })),
    );
    setClassName("");
    router.refresh();
  }

  async function handleDeleteClass(schoolClass: SchoolClass) {
    if (!window.confirm(`Удалить пустой класс «${schoolClass.name}»?`)) return;
    setError(null);
    setDeletingId(schoolClass.id);

    const result = await apiRequest<{ deleted: true }>(`/api/admin/classes/${schoolClass.id}`, {
      method: "DELETE",
    });
    setDeletingId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setClasses((current) => current.filter((item) => item.id !== schoolClass.id));
    router.refresh();
  }

  return (
    <section aria-labelledby="school-settings-title" className="ring-gradient glass-card p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-300">Школа</p>
          <h2 id="school-settings-title" className="mt-1 whitespace-pre-wrap text-xl font-semibold text-white">
            {school.name}
          </h2>
          <p className="mt-2 text-sm text-slate-400">Код для регистрации учеников и учителей</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-400/20 bg-brand-500/10 p-3 sm:p-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-brand-200">Код вашей школы</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-[0.14em] text-white sm:text-3xl">
              {school.code}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyCode()}
            aria-label={copied ? "Код скопирован" : "Копировать код"}
            title={copied ? "Скопировано" : "Копировать код"}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
            {copied ? "Скопировано" : "Копировать код"}
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-white/10 pt-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">Классы школы</h3>
            <p className="mt-1 text-xs text-slate-400">Создавайте группы и удаляйте только пустые классы.</p>
          </div>

          <form onSubmit={handleCreateClass} className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-md">
            <TextField
              label="Название класса"
              placeholder="Например, 7-В"
              value={className}
              maxLength={8}
              error={fieldError}
              onChange={(event) => {
                setClassName(event.target.value);
                setFieldError(undefined);
              }}
            />
            <button
              type="submit"
              disabled={isCreating || !className.trim()}
              className="inline-flex h-[46px] shrink-0 items-center justify-center gap-2 self-end rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50 sm:mb-0.5"
            >
              <Plus className="h-4 w-4" />
              {isCreating ? "Создаём…" : "Добавить"}
            </button>
          </form>
        </div>

        {error ? (
          <div className="mt-4">
            <FormAlert variant="error" onDismiss={() => setError(null)}>
              {error}
            </FormAlert>
          </div>
        ) : null}

        {classes.length === 0 ? (
          <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
            В школе пока нет классов.
          </p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {classes.map((schoolClass) => (
              <li
                key={schoolClass.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-3"
              >
                <span className="font-medium text-slate-100">{schoolClass.name}</span>
                <button
                  type="button"
                  onClick={() => void handleDeleteClass(schoolClass)}
                  disabled={deletingId === schoolClass.id}
                  aria-label={`Удалить класс ${schoolClass.name}`}
                  title="Удалить пустой класс"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-wait disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
