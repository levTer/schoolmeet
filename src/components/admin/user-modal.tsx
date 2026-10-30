"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldOff, UserPlus, UserRound } from "lucide-react";
import { toast } from "sonner";

import { TextField } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { GradientButton } from "@/components/ui/gradient-button";
import { SelectField } from "@/components/ui/form-controls";
import type { AdminUserRow } from "@/lib/admin-users";
import { adminCapabilities, type AdminActor } from "@/lib/admin-permissions";
import { apiRequest } from "@/lib/client-api";
import { GRADES, GRADE_LABELS, type GradeCode } from "@/lib/schedule-rules";
import { ROLES, ROLE_LABELS, type Role } from "@/types";

interface UserModalProps {
  /** `create` — новая учётная запись, `edit` — правка существующей. */
  mode: "create" | "edit";
  user?: AdminUserRow;
  actor: AdminActor;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  name: string;
  email: string;
  password: string;
  role: Role;
  grade: GradeCode | "NONE";
  isBanned: boolean;
}

function toFormState(user?: AdminUserRow): FormState {
  return {
    name: user?.name ?? "",
    email: user?.email ?? "",
    password: "",
    role: user?.role ?? "STUDENT",
    grade: user?.grade ?? "NONE",
    isBanned: user?.isBanned ?? false,
  };
}

/**
 * Модалка пользователя: создание учётной записи, смена роли и класса,
 * сброс пароля и блокировка.
 *
 * Недоступные текущей роли поля выключаются (подсказка — почему), но решение
 * всё равно принимает сервер: `admin-permissions.ts` используется и в API.
 */
export function UserModal({ mode, user, actor, onClose, onSaved }: UserModalProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(user));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Сброс второго фактора — отдельное действие: админ не должен менять роль
  // или пароль, чтобы «разморозить» ребёнка, потерявшего телефон.
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(user?.twoFactorEnabled ?? false);
  const [resetting, setResetting] = useState(false);

  const capabilities = adminCapabilities(actor, user ? { id: user.id, role: user.role } : undefined);
  const isEdit = mode === "edit" && Boolean(user);

  useEffect(() => {
    setForm(toFormState(user));
    setFields({});
    setError(null);
  }, [user]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /**
   * Снять второй фактор с аккаунта.
   *
   * Нужно, когда ребёнок потерял телефон и резервные коды: без этой кнопки
   * администратору пришлось бы править базу руками. Пароль не меняется,
   * блокировка не снимается — только второй фактор.
   */
  const resetTwoFactor = async () => {
    if (!isEdit || !user) return;
    setError(null);
    setResetting(true);
    try {
      const result = await apiRequest(`/api/admin/users/${user.id}/2fa`, { method: "DELETE" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTwoFactorEnabled(false);
      toast.success("Второй фактор снят: вход снова по паролю");
      onSaved();
    } finally {
      setResetting(false);
    }
  };

  const submit = async () => {
    setError(null);
    setPending(true);

    let result;

    if (isEdit && user) {
      const patch: Record<string, unknown> = {};
      if (form.name.trim() !== user.name) patch.name = form.name.trim();
      if (form.role !== user.role) patch.role = form.role;
      if ((form.grade === "NONE" ? null : form.grade) !== user.grade) {
        patch.grade = form.grade === "NONE" ? null : form.grade;
      }
      if (form.password) patch.password = form.password;
      if (form.isBanned !== user.isBanned) patch.isBanned = form.isBanned;

      if (Object.keys(patch).length === 0) {
        setPending(false);
        toast.info("Изменений нет");
        return;
      }

      result = await apiRequest(`/api/admin/users/${user.id}`, { method: "PATCH", json: patch });
    } else {
      result = await apiRequest("/api/admin/users", {
        method: "POST",
        json: {
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          grade: form.role === "STUDENT" && form.grade !== "NONE" ? form.grade : null,
        },
      });
    }

    setPending(false);

    if (!result.ok) {
      setFields(result.fields ?? {});
      setError(result.error);
      return;
    }

    toast.success(isEdit ? "Данные пользователя обновлены" : "Пользователь создан");
    onSaved();
    router.refresh();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Редактирование пользователя" : "Новый пользователь"}
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/60 px-0 pb-0 pt-0 backdrop-blur md:items-center md:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="glass-strong animate-fade-up my-0 max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-3xl rounded-b-none p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-glow md:my-auto md:max-h-none md:overflow-visible md:rounded-3xl md:p-7 md:pb-7">
        <div aria-hidden className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20 md:hidden" />
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
            {isEdit ? <UserRound className="h-5 w-5 text-white" /> : <UserPlus className="h-5 w-5 text-white" />}
          </span>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">
              {isEdit ? user?.name ?? "Пользователь" : "Новый пользователь"}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {isEdit
                ? user?.email
                : "Аккаунт создаётся администратором — пароль нужно будет передать лично."}
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {error && <FormAlert variant="error">{error}</FormAlert>}

          <TextField
            label="Имя и фамилия"
            value={form.name}
            error={fields.name}
            disabled={isEdit && !capabilities["users.edit"]}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />

          {!isEdit && (
            <TextField
              label="Email"
              type="email"
              value={form.email}
              error={fields.email}
              placeholder="ivanov@school.ru"
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          )}

          <TextField
            label={isEdit ? "Новый пароль (сброс)" : "Пароль"}
            type="password"
            value={form.password}
            error={fields.password}
            disabled={isEdit && !capabilities["users.password.reset"]}
            hint={isEdit ? "Оставьте пустым, чтобы не менять пароль." : "Минимум 8 символов, буква и цифра."}
            placeholder={isEdit ? "••••••••" : "Например, School2026"}
            onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Роль"
              value={form.role}
              error={fields.role}
              disabled={!capabilities["users.role.change"]}
              hint={!capabilities["users.role.change"] ? "Роль меняет только администратор" : undefined}
              onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as Role }))}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]} · {role}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Класс"
              value={form.grade}
              error={fields.grade}
              disabled={form.role !== "STUDENT" || !capabilities["users.grade.change"]}
              hint={form.role !== "STUDENT" ? "Класс назначается только ученикам" : undefined}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, grade: event.target.value as GradeCode | "NONE" }))
              }
            >
              <option value="NONE">Не назначен</option>
              {GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {GRADE_LABELS[grade]}
                </option>
              ))}
            </SelectField>
          </div>

          {isEdit && (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-100 transition hover:bg-rose-500/[0.12]">
              <span className="flex flex-col">
                <span className="font-medium">Заблокировать аккаунт</span>
                <span className="text-[11px] text-rose-200/70">
                  Вход будет запрещён, а сокет-сессии — разорваны немедленно.
                </span>
              </span>
              <input
                type="checkbox"
                checked={form.isBanned}
                disabled={!capabilities["users.ban"]}
                onChange={(event) => setForm((prev) => ({ ...prev, isBanned: event.target.checked }))}
                className="h-4 w-4 shrink-0 accent-rose-500"
              />
            </label>
          )}

          {isEdit && twoFactorEnabled && (
            <div className="flex flex-col gap-2 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-medium text-amber-100">
                <KeyRound className="h-4 w-4" />
                Второй фактор включён
              </span>
              <span className="text-[11px] leading-relaxed text-amber-200/70">
                Если ученик или учитель потерял телефон и резервные коды — снимите защиту:
                вход снова будет по паролю. Действие попадёт в журнал аудита.
              </span>
              <button
                type="button"
                disabled={resetting || !capabilities["users.password.reset"]}
                onClick={() => void resetTwoFactor()}
                className="inline-flex w-fit items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldOff className="h-3.5 w-3.5" />
                {resetting ? "Снимаем…" : "Снять второй фактор"}
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
            <GradientButton
              type="button"
              loading={pending}
              loadingText="Сохраняем…"
              fullWidth={false}
              className="flex-1 sm:flex-none sm:px-8"
              onClick={() => void submit()}
            >
              {isEdit ? "Сохранить" : "Создать"}
            </GradientButton>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
